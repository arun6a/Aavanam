/**
 * Async job worker — runs the full extraction pipeline for one job.
 *
 * Same logic the old /api/extract route did synchronously, now runs in the
 * background after the API returns 202 + job_id.
 *
 * Pipeline:
 *   1. Load job + template from DB
 *   2. Read source file from disk
 *   3. Detect MIME type
 *   4. PDF → text via unpdf (or OCR if scanned); Image → OCR; DOCX → mammoth; XLSX → xlsx
 *   5. Multi-invoice detection (auto / on / off)
 *   6. LLM extraction per chunk (auto-splits large templates)
 *   7. Schema validation
 *   8. Persist result + mark job done
 *   9. Fire webhook(s) if configured
 */

import fs from 'fs/promises'
import { fileTypeFromBuffer } from 'file-type'

import { db } from '@/lib/db'
import { extractPdfText } from '@/lib/pdf/extract'
import { runOcrEngines } from '@/lib/ocr'
import { getLlmAdapter } from '@/lib/extraction/extractor'
import { splitMultiInvoiceText } from '@/lib/extraction/multi-invoice'
import { validateExtraction } from '@/lib/validation/validate'
import { deserializeTemplateFields, type TemplateDef } from '@/lib/templates/schema'
import { logAudit } from '@/lib/audit'
import { fireWebhooksForJob } from '@/lib/webhooks'

// Additional file formats (DOCX, XLSX) — Phase M7
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'

const ALLOWED_MIMES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/tiff',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',  // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',  // .xlsx
  'application/vnd.ms-excel',  // .xls (legacy)
]

export async function processJob(jobId: string): Promise<void> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    include: { template: true },
  })
  if (!job) {
    console.error(`[worker] job ${jobId} not found`)
    return
  }
  if (job.status !== 'queued' && job.status !== 'processing') {
    console.log(`[worker] job ${jobId} already ${job.status}, skipping`)
    return
  }

  const startTotal = Date.now()
  try {
    await db.job.update({ where: { id: jobId }, data: { status: 'processing', stage: 'parsing' } })

    const template: TemplateDef = {
      id: job.template.id,
      name: job.template.name,
      documentType: job.template.documentType,
      fields: deserializeTemplateFields(job.template.fieldsJson),
      instructions: job.template.instructions ?? undefined,
    }

    // ── Stage 1: Load file + detect type ───────────────────────────────────
    const fileBuffer = await fs.readFile(job.storagePath)
    const detected = await fileTypeFromBuffer(fileBuffer)
    const mimeType = detected?.mime ?? job.mimeType

    if (!ALLOWED_MIMES.includes(mimeType)) {
      throw new Error(`Unsupported file type: ${mimeType}`)
    }

    // ── Stage 2: Extract text (PDF / image / DOCX / XLSX) ────────────────────
    let text = ''
    let ocrEngine: string | null = null
    let ocrConfidence: number | null = null
    let ocrTimeMs: number | null = null
    let pdfTextLength: number | null = null
    let pdfTimeMs: number | null = null

    if (mimeType === 'application/pdf') {
      const pdfResult = await extractPdfText(fileBuffer)
      pdfTextLength = pdfResult.text_length
      pdfTimeMs = pdfResult.time_ms
      if (pdfResult.is_scanned) {
        const ocrResults = await runOcrEngines(fileBuffer, mimeType, ['tesseract'])
        if (ocrResults.length > 0) {
          text = ocrResults[0].text
          ocrEngine = ocrResults[0].engine
          ocrConfidence = ocrResults[0].confidence
          ocrTimeMs = ocrResults[0].timeMs
        }
      } else {
        text = pdfResult.text
        ocrEngine = 'none'
      }
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || job.fileName.toLowerCase().endsWith('.docx')) {
      // DOCX → extract text via mammoth
      const result = await mammoth.extractRawText({ buffer: fileBuffer })
      text = result.value
      ocrEngine = 'none'
    } else if (
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimeType === 'application/vnd.ms-excel' ||
      job.fileName.toLowerCase().endsWith('.xlsx') ||
      job.fileName.toLowerCase().endsWith('.xls')
    ) {
      // XLSX → convert to text via xlsx
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' })
      const lines: string[] = []
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName]
        const csv = XLSX.utils.sheet_to_csv(sheet)
        lines.push(`# Sheet: ${sheetName}\n${csv}`)
      }
      text = lines.join('\n\n')
      ocrEngine = 'none'
    } else {
      // Image — OCR directly
      const ocrResults = await runOcrEngines(fileBuffer, mimeType, ['tesseract'])
      if (ocrResults.length > 0) {
        text = ocrResults[0].text
        ocrEngine = ocrResults[0].engine
        ocrConfidence = ocrResults[0].confidence
        ocrTimeMs = ocrResults[0].timeMs
      }
    }

    if (!text || text.trim().length === 0) {
      await db.job.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          stage: 'parsing',
          errorMessage: 'No text could be extracted from the document',
          errorCode: 'NO_TEXT',
          ocrEngine, ocrConfidence, ocrTimeMs, pdfTextLength, pdfTimeMs,
          totalProcessingMs: Date.now() - startTotal,
          completedAt: new Date(),
        },
      })
      await fireWebhooksForJob(jobId, 'job.failed')
      return
    }

    // ── Stage 3: Multi-invoice detection ────────────────────────────────────
    let invoiceChunks: Array<{ marker: string; text: string }> = [{ marker: '(single)', text }]
    let multiInvoiceDetected = false
    let multiInvoiceTimeMs = 0
    // TODO v2: read this from job metadata — for MVP always auto
    const multiInvoiceMode = 'auto'
    if (multiInvoiceMode !== 'off') {
      const splitStart = Date.now()
      const chunks = await splitMultiInvoiceText(text)
      multiInvoiceTimeMs = Date.now() - splitStart
      if (chunks.length > 1 || (chunks.length === 1 && chunks[0].marker !== '(single)')) {
        invoiceChunks = chunks
        multiInvoiceDetected = true
      }
    }

    // ── Stage 4: LLM extraction per chunk ──────────────────────────────────
    await db.job.update({
      where: { id: jobId },
      data: { stage: 'extraction', ocrText: text, ocrEngine, ocrConfidence, ocrTimeMs, pdfTextLength, pdfTimeMs },
    })
    const llm = getLlmAdapter()

    type DocumentResult = {
      marker: string
      data: Record<string, unknown>
      validation: ReturnType<typeof validateExtraction>
      extraction: { rawResponse: string; timeMs: number; tokensIn: number; tokensOut: number }
    }
    let documents: DocumentResult[] = []
    let singleResult: DocumentResult | null = null

    if (multiInvoiceDetected && invoiceChunks.length > 1) {
      for (const chunk of invoiceChunks) {
        const ext = await llm.extract(chunk.text, template)
        const val = validateExtraction(ext.data, template)
        documents.push({
          marker: chunk.marker,
          data: ext.data,
          validation: val,
          extraction: { rawResponse: ext.rawResponse, timeMs: ext.timeMs, tokensIn: ext.tokensIn, tokensOut: ext.tokensOut },
        })
      }
    } else {
      const ext = await llm.extract(text, template)
      const val = validateExtraction(ext.data, template)
      singleResult = {
        marker: '(single)',
        data: ext.data,
        validation: val,
        extraction: { rawResponse: ext.rawResponse, timeMs: ext.timeMs, tokensIn: ext.tokensIn, tokensOut: ext.tokensOut },
      }
    }

    // ── Stage 5: Validation aggregation ────────────────────────────────────
    const allValidations = multiInvoiceDetected
      ? documents.map(d => d.validation)
      : (singleResult ? [singleResult.validation] : [])
    const allValid = allValidations.every(v => v.is_valid)
    const allMissing = allValidations.flatMap(v => v.missing_fields)
    const allIssues = allValidations.flatMap(v => v.issues)
    const finalStatus = allValid ? 'completed' : 'review_required'

    const totalLlmTime = multiInvoiceDetected
      ? documents.reduce((s, d) => s + d.extraction.timeMs, 0) + multiInvoiceTimeMs
      : (singleResult?.extraction.timeMs ?? 0)
    const totalTokensIn = multiInvoiceDetected
      ? documents.reduce((s, d) => s + d.extraction.tokensIn, 0)
      : (singleResult?.extraction.tokensIn ?? 0)
    const totalTokensOut = multiInvoiceDetected
      ? documents.reduce((s, d) => s + d.extraction.tokensOut, 0)
      : (singleResult?.extraction.tokensOut ?? 0)

    const storedJson = multiInvoiceDetected
      ? JSON.stringify({
          documents: documents.map(d => ({
            marker: d.marker,
            data: d.data,
            validation: d.validation,
          })),
        })
      : JSON.stringify(singleResult?.data ?? {})

    await db.job.update({
      where: { id: jobId },
      data: {
        status: finalStatus,
        stage: 'done',
        extractedJson: storedJson,
        llmModel: 'zai-glm-4',
        llmTimeMs: totalLlmTime,
        llmTokensIn: totalTokensIn,
        llmTokensOut: totalTokensOut,
        validationJson: JSON.stringify({
          is_valid: allValid,
          missing_fields: allMissing,
          issues: allIssues,
          multi_invoice: multiInvoiceDetected,
          document_count: multiInvoiceDetected ? documents.length : 1,
        }),
        multiInvoice: multiInvoiceDetected,
        documentCount: multiInvoiceDetected ? documents.length : 1,
        validationTimeMs: 0,
        totalProcessingMs: Date.now() - startTotal,
        completedAt: new Date(),
      },
    })

    // Audit log
    await logAudit({
      ctx: {
        organizationId: job.organizationId,
        actorType: 'system',
        actorId: null,
        role: 'system' as 'admin',
      },
      action: multiInvoiceDetected ? 'job.complete_multi' : 'job.complete',
      resourceType: 'job',
      resourceId: jobId,
      metadata: { status: finalStatus, ms: Date.now() - startTotal, multi: multiInvoiceDetected },
    })

    // Fire webhook
    const webhookEvent = finalStatus === 'completed' ? 'job.completed' : 'job.review_required'
    await fireWebhooksForJob(jobId, webhookEvent)
  } catch (e) {
    console.error(`[worker] job ${jobId} error:`, e)
    await db.job.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        stage: 'failed',
        errorMessage: e instanceof Error ? e.message : 'Unknown error',
        errorCode: 'PROCESSING_ERROR',
        totalProcessingMs: Date.now() - startTotal,
        completedAt: new Date(),
      },
    })
    await fireWebhooksForJob(jobId, 'job.failed')
  }
}
