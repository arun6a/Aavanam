/**
 * POST /api/templates/[id]/test
 *   multipart/form-data:
 *     file: PDF/PNG/JPG/TIFF/DOCX/XLSX (sample document to test against)
 *
 * Per BRD §6.1 — "Test a draft against sample documents."
 *
 * This runs the FULL extraction pipeline on the uploaded file using the
 * draft template, but does NOT persist a job to the DB. Returns the
 * extraction result + validation inline so the template builder can see
 * "if I publish this template and use it, here's what would happen."
 *
 * Difference from /api/extract:
 *   - Test endpoint: no DB write, returns 200 with full result inline
 *   - Extract endpoint: creates a job, returns 202 with job_id, async
 *
 * Both go through the same lib/queue/worker.processJob logic (refactored to
 * share the core pipeline).
 */

import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import { fileTypeFromBuffer } from 'file-type'

import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/auth-context'
import { logAudit } from '@/lib/audit'
import { extractPdfText } from '@/lib/pdf/extract'
import { runOcrEngines } from '@/lib/ocr'
import { getLlmAdapter } from '@/lib/extraction/extractor'
import { splitMultiInvoiceText } from '@/lib/extraction/multi-invoice'
import { validateExtraction } from '@/lib/validation/validate'
import { deserializeTemplateFields, type TemplateDef } from '@/lib/templates/schema'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const UPLOAD_DIR = '/tmp/aavanam-test-uploads'

const ALLOWED_MIMES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/tiff',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext(req)
  if (!ctx || ctx.role === 'api') {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } }, { status: 401 })
  }
  const { id } = await params

  const tpl = await db.template.findFirst({
    where: { id, organizationId: ctx.organizationId },
  })
  if (!tpl) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Template not found' } }, { status: 404 })
  }

  try {
    const formData = await req.formData()
    const file = formData.get('file')
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: { code: 'NO_FILE', message: 'No file uploaded.' } }, { status: 400 })
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: { code: 'FILE_TOO_LARGE', message: `Max ${MAX_FILE_SIZE / 1024 / 1024} MB` } }, { status: 413 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const detected = await fileTypeFromBuffer(buffer)
    const mimeType = detected?.mime ?? file.type
    if (!ALLOWED_MIMES.includes(mimeType)) {
      return NextResponse.json({ error: { code: 'FILE_TYPE_NOT_SUPPORTED', message: `Unsupported: ${mimeType}` } }, { status: 415 })
    }

    const template: TemplateDef = {
      id: tpl.id,
      name: tpl.name,
      documentType: tpl.documentType,
      fields: deserializeTemplateFields(tpl.fieldsJson),
      instructions: tpl.instructions ?? undefined,
    }

    // Extract text
    let text = ''
    if (mimeType === 'application/pdf') {
      const pdfResult = await extractPdfText(buffer)
      if (pdfResult.is_scanned) {
        const ocr = await runOcrEngines(buffer, mimeType, ['tesseract'])
        text = ocr[0]?.text ?? ''
      } else {
        text = pdfResult.text
      }
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || file.name.toLowerCase().endsWith('.docx')) {
      const r = await mammoth.extractRawText({ buffer })
      text = r.value
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || file.name.toLowerCase().endsWith('.xlsx')) {
      const wb = XLSX.read(buffer, { type: 'buffer' })
      text = wb.SheetNames.map(s => `# Sheet: ${s}\n${XLSX.utils.sheet_to_csv(wb.Sheets[s])}`).join('\n\n')
    } else {
      const ocr = await runOcrEngines(buffer, mimeType, ['tesseract'])
      text = ocr[0]?.text ?? ''
    }

    if (!text.trim()) {
      return NextResponse.json({
        template_id: tpl.id,
        template_name: tpl.name,
        status: 'failed',
        error: 'No text could be extracted from the document.',
        extracted_text_length: 0,
      })
    }

    // Multi-invoice detect
    const chunks = await splitMultiInvoiceText(text)
    const multi = chunks.length > 1 || (chunks.length === 1 && chunks[0].marker !== '(single)'))

    // Extract per chunk
    const llm = getLlmAdapter()
    const documents = []
    for (const chunk of chunks) {
      const ext = await llm.extract(chunk.text, template)
      const val = validateExtraction(ext.data, template)
      documents.push({
        marker: chunk.marker,
        data: ext.data,
        validation: val,
      })
    }

    await logAudit({
      ctx,
      action: 'template.test',
      resourceType: 'template',
      resourceId: tpl.id,
      metadata: { fileName: file.name, multi, docCount: documents.length },
    })

    return NextResponse.json({
      template_id: tpl.id,
      template_name: tpl.name,
      template_version: `${tpl.version}.0`,
      template_is_published: tpl.isPublished,
      status: 'completed',
      multi_invoice: multi,
      document_count: documents.length,
      documents,
      extracted_text_length: text.length,
      raw_ocr_text: text,
    })
  } catch (e) {
    console.error('[template/test] error:', e)
    return NextResponse.json({ error: { code: 'INTERNAL', message: e instanceof Error ? e.message : 'Unknown' } }, { status: 500 })
  }
}
