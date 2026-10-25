/**
 * POST /api/extract
 *   multipart/form-data:
 *     file:        PDF, PNG, or JPG/JPEG (per BRD §2 P0)
 *     templateId:  (optional, defaults to starter invoice template)
 *   Returns: 200 OK with full extraction result.
 *
 * Per BRD §5.2 pipeline:
 *   1. Validate file size + signature + MIME type
 *   2. Store source file in /tmp/extract-uploads/
 *   3. Create Job record (status = processing)
 *   4. If PDF → extract text via pdf-parse → check is_scanned
 *   5. If image OR scanned PDF → run Tesseract OCR
 *   6. Send text + template to LLM → get structured JSON
 *   7. Validate against template schema
 *   8. Persist result + update job status (completed | review_required | failed)
 *   9. Return full result
 *
 * MVP: synchronous (no queue). BRD recommends async via queue for v2.
 */

import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import { fileTypeFromBuffer } from 'file-type'

import { db } from '@/lib/db'
import { extractPdfText } from '@/lib/pdf/extract'
import { runOcrEngines } from '@/lib/ocr'
import { getLlmAdapter } from '@/lib/extraction/extractor'
import { splitMultiInvoiceText } from '@/lib/extraction/multi-invoice'
import { validateExtraction } from '@/lib/validation/validate'
import {
  deserializeTemplateFields,
  type TemplateDef,
  type FieldDef,
} from '@/lib/templates/schema'

// ─── Limits ────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024  // 10 MB
const ALLOWED_MIMES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]
const UPLOAD_DIR = '/tmp/extract-uploads'

// ─── Helpers ───────────────────────────────────────────────────────────────

async function ensureUploadDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true })
}

async function getTemplate(templateId: string | null): Promise<TemplateDef> {
  if (templateId) {
    const t = await db.template.findUnique({ where: { id: templateId } })
    if (t) {
      return {
        id: t.id,
        name: t.name,
        documentType: t.documentType,
        fields: deserializeTemplateFields(t.fieldsJson),
        instructions: t.instructions ?? undefined,
      }
    }
  }
  // Default: find any template, or the first one
  const first = await db.template.findFirst({ orderBy: { createdAt: 'asc' } })
  if (first) {
    return {
      id: first.id,
      name: first.name,
      documentType: first.documentType,
      fields: deserializeTemplateFields(first.fieldsJson),
      instructions: first.instructions ?? undefined,
    }
  }
  // Shouldn't happen if seeded — fail loudly
  throw new Error('No templates exist. Run /api/templates/seed first.')
}

// ─── POST handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startTotal = Date.now()
  try {
    const formData = await req.formData()
    const file = formData.get('file')
    const templateId = (formData.get('templateId') as string | null) ?? null
    // Multi-invoice mode (per BRD §5.2 — split bundled PDFs into per-invoice jobs):
    //   'auto' (default) — auto-detect via heuristic + LLM splitter if >=2 invoice markers
    //   'on'              — always run the LLM splitter (forces multi-invoice mode)
    //   'off'             — never split (treat as single document)
    const multiInvoiceRaw = (formData.get('multiInvoice') as string | null) ?? 'auto'
    const multiInvoiceMode: 'auto' | 'on' | 'off' =
      multiInvoiceRaw === 'on' ? 'on' :
      multiInvoiceRaw === 'off' ? 'off' : 'auto'

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: { code: 'NO_FILE', message: 'No file uploaded.' } },
        { status: 400 },
      )
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: { code: 'FILE_TOO_LARGE', message: `Max file size is ${MAX_FILE_SIZE / 1024 / 1024} MB` } },
        { status: 413 },
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const detected = await fileTypeFromBuffer(buffer)
    const mimeType = detected?.mime ?? file.type

    if (!ALLOWED_MIMES.includes(mimeType)) {
      return NextResponse.json(
        { error: { code: 'FILE_TYPE_NOT_SUPPORTED', message: `Unsupported file type: ${mimeType}` } },
        { status: 415 },
      )
    }

    await ensureUploadDir()
    const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const storagePath = path.join(UPLOAD_DIR, safeName)
    await fs.writeFile(storagePath, buffer)

    const template = await getTemplate(templateId)

    // Create job record
    const job = await db.job.create({
      data: {
        templateId: template.id,
        fileName: file.name,
        fileSize: file.size,
        mimeType,
        storagePath,
        status: 'processing',
        stage: 'parsing',
      },
    })

    // ── Stage 1: PDF text extraction OR OCR ───────────────────────────────
    let text = ''
    let ocrEngine: string | null = null
    let ocrConfidence: number | null = null
    let ocrTimeMs: number | null = null
    let pdfTextLength: number | null = null
    let pdfTimeMs: number | null = null

    if (mimeType === 'application/pdf') {
      const pdfResult = await extractPdfText(buffer)
      pdfTextLength = pdfResult.text_length
      pdfTimeMs = pdfResult.time_ms
      if (pdfResult.is_scanned) {
        const ocrResults = await runOcrEngines(buffer, mimeType, ['tesseract'])
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
    } else {
      // Image — OCR directly
      const ocrResults = await runOcrEngines(buffer, mimeType, ['tesseract'])
      if (ocrResults.length > 0) {
        text = ocrResults[0].text
        ocrEngine = ocrResults[0].engine
        ocrConfidence = ocrResults[0].confidence
        ocrTimeMs = ocrResults[0].timeMs
      }
    }

    if (!text || text.trim().length === 0) {
      await db.job.update({
        where: { id: job.id },
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
      return NextResponse.json({
        error: {
          code: 'NO_TEXT',
          message: 'No text could be extracted. The document may be a scanned PDF (needs rasterization), a blank image, or use a language not supported by Tesseract.',
          job_id: job.id,
        },
      }, { status: 422 })
    }

    // ── Stage 2: Multi-invoice detection (optional) ──────────────────────
    // Per BRD §5.2: "Inspect PDF text quality" — detect bundled invoices.
    let invoiceChunks: Array<{ marker: string; text: string }> = [{ marker: '(single)', text }]
    let multiInvoiceDetected = false
    let multiInvoiceTimeMs = 0
    if (multiInvoiceMode !== 'off') {
      const splitStart = Date.now()
      const chunks = await splitMultiInvoiceText(text)
      multiInvoiceTimeMs = Date.now() - splitStart
      if (chunks.length > 1 || (chunks.length === 1 && chunks[0].marker !== '(single)')) {
        invoiceChunks = chunks
        multiInvoiceDetected = true
        console.log('[extract] multi-invoice detected', { count: chunks.length, ms: multiInvoiceTimeMs })
      }
    }

    // ── Stage 3: LLM extraction per chunk ────────────────────────────────
    await db.job.update({ where: { id: job.id }, data: { stage: 'extraction', ocrText: text, ocrEngine, ocrConfidence, ocrTimeMs, pdfTextLength, pdfTimeMs } })
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
      // Sequential extraction per chunk (parallel would hit rate limits on Z.ai)
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

    // Aggregate validation across all documents (if multi)
    const allValidations = multiInvoiceDetected
      ? documents.map(d => d.validation)
      : (singleResult ? [singleResult.validation] : [])
    const allValid = allValidations.every(v => v.is_valid)
    const allMissing = allValidations.flatMap(v => v.missing_fields)
    const allIssues = allValidations.flatMap(v => v.issues)
    const finalStatus = allValid ? 'completed' : 'review_required'

    // Aggregate LLM stats
    const totalLlmTime = multiInvoiceDetected
      ? documents.reduce((s, d) => s + d.extraction.timeMs, 0) + multiInvoiceTimeMs
      : (singleResult?.extraction.timeMs ?? 0)
    const totalTokensIn = multiInvoiceDetected
      ? documents.reduce((s, d) => s + d.extraction.tokensIn, 0)
      : (singleResult?.extraction.tokensIn ?? 0)
    const totalTokensOut = multiInvoiceDetected
      ? documents.reduce((s, d) => s + d.extraction.tokensOut, 0)
      : (singleResult?.extraction.tokensOut ?? 0)
    const rawLlmResponse = multiInvoiceDetected
      ? JSON.stringify(documents.map(d => ({ marker: d.marker, raw: d.extraction.rawResponse })))
      : (singleResult?.extraction.rawResponse ?? '')

    // For DB storage: store the multi-doc shape as `{ documents: [...] }` if multi,
    // else store the single document directly. Include per-doc validation for multi.
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
      where: { id: job.id },
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
        validationTimeMs: 0,
        totalProcessingMs: Date.now() - startTotal,
        completedAt: new Date(),
      },
    })

    if (multiInvoiceDetected) {
      return NextResponse.json({
        job_id: job.id,
        status: finalStatus,
        template: { id: template.id, name: template.name },
        multi_invoice: true,
        document_count: documents.length,
        documents: documents.map(d => ({
          marker: d.marker,
          data: d.data,
          validation: d.validation,
        })),
        diagnostics: {
          ocr_engine: ocrEngine,
          ocr_confidence: ocrConfidence,
          ocr_time_ms: ocrTimeMs,
          pdf_text_length: pdfTextLength,
          pdf_time_ms: pdfTimeMs,
          multi_invoice_detected: true,
          multi_invoice_split_ms: multiInvoiceTimeMs,
          llm_model: 'zai-glm-4',
          llm_time_ms: totalLlmTime,
          llm_tokens_in: totalTokensIn,
          llm_tokens_out: totalTokensOut,
          total_processing_ms: Date.now() - startTotal,
        },
        raw_ocr_text: text,
        raw_llm_response: rawLlmResponse,
      })
    }

    return NextResponse.json({
      job_id: job.id,
      status: finalStatus,
      template: { id: template.id, name: template.name },
      multi_invoice: false,
      data: singleResult?.data ?? {},
      validation: singleResult?.validation ?? { is_valid: false, missing_fields: [], issues: [] },
      diagnostics: {
        ocr_engine: ocrEngine,
        ocr_confidence: ocrConfidence,
        ocr_time_ms: ocrTimeMs,
        pdf_text_length: pdfTextLength,
        pdf_time_ms: pdfTimeMs,
        multi_invoice_detected: false,
        multi_invoice_split_ms: 0,
        llm_model: 'zai-glm-4',
        llm_time_ms: totalLlmTime,
        llm_tokens_in: totalTokensIn,
        llm_tokens_out: totalTokensOut,
        total_processing_ms: Date.now() - startTotal,
      },
      raw_ocr_text: text,
      raw_llm_response: rawLlmResponse,
    })
  } catch (e: unknown) {
    console.error('[extract] error:', e)
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json(
      { error: { code: 'INTERNAL', message } },
      { status: 500 },
    )
  }
}

// ─── GET /api/extract ──────────────────────────────────────────────────────
// Returns metadata for the extract endpoint — supported formats, limits.
export async function GET() {
  return NextResponse.json({
    max_file_size_bytes: MAX_FILE_SIZE,
    max_file_size_mb: MAX_FILE_SIZE / 1024 / 1024,
    allowed_mime_types: ALLOWED_MIMES,
    ocr_engines: [
      { id: 'tesseract', name: 'Tesseract 5 (English)', available: true },
      { id: 'paddleocr', name: 'PaddleOCR v5', available: false,
        note: 'Needs Python worker — deploy to a server with Python to enable.' },
    ],
    llm_provider: 'zai',
    llm_model: 'zai-glm-4',
  })
}
