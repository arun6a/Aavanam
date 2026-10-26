/**
 * POST /api/analyse
 *   multipart/form-data:
 *     file: PDF/PNG/JPG/TIFF/DOCX/XLSX (sample document)
 *   Returns: AI-suggested field definitions to seed the template builder.
 *
 * Per BRD §3 US-03 — "System proposes fields with types and sample values;
 * user can edit all suggestions."
 *
 * Org-scoped: requires authentication (session OR API key).
 */

import { NextRequest, NextResponse } from 'next/server'
import { fileTypeFromBuffer } from 'file-type'
import { extractPdfText } from '@/lib/pdf/extract'
import { runOcrEngines } from '@/lib/ocr'
import { parseLlmJsonOrArray, detectDocType } from '@/lib/extraction/analyse-helpers'
import { getAuthContext } from '@/lib/auth-context'
import type { FieldDef } from '@/lib/templates/schema'

const MAX_SIZE = 10 * 1024 * 1024
const ALLOWED = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/tiff',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req)
  if (!ctx) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in or pass an API key.' } }, { status: 401 })
  }
  try {
    const formData = await req.formData()
    const file = formData.get('file')
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: { code: 'NO_FILE', message: 'No file uploaded.' } }, { status: 400 })
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: { code: 'FILE_TOO_LARGE', message: 'Max 10 MB.' } }, { status: 413 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const detected = await fileTypeFromBuffer(buffer)
    const mimeType = detected?.mime ?? file.type
    if (!ALLOWED.includes(mimeType)) {
      return NextResponse.json({ error: { code: 'FILE_TYPE_NOT_SUPPORTED', message: `Unsupported: ${mimeType}` } }, { status: 415 })
    }

    let text = ''
    if (mimeType === 'application/pdf') {
      const pdf = await extractPdfText(buffer)
      if (pdf.is_scanned) {
        const ocr = await runOcrEngines(buffer, mimeType, ['tesseract'])
        text = ocr[0]?.text ?? ''
      } else {
        text = pdf.text
      }
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || file.name.toLowerCase().endsWith('.docx')) {
      const mammoth = (await import('mammoth')).default
      const r = await mammoth.extractRawText({ buffer })
      text = r.value
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || file.name.toLowerCase().endsWith('.xlsx')) {
      const XLSX = (await import('xlsx')).default
      const wb = XLSX.read(buffer, { type: 'buffer' })
      text = wb.SheetNames.map(s => `# Sheet: ${s}\n${XLSX.utils.sheet_to_csv(wb.Sheets[s])}`).join('\n\n')
    } else {
      const ocr = await runOcrEngines(buffer, mimeType, ['tesseract'])
      text = ocr[0]?.text ?? ''
    }

    if (!text.trim()) {
      return NextResponse.json({
        suggested_fields: [],
        text_length: 0,
        message: 'No text could be extracted from the document.',
      })
    }

    const zai = (await import('z-ai-web-dev-sdk')).default
    const z = await zai.create()

    const systemPrompt = `You are a document analysis assistant. The user has uploaded a sample ${mimeType === 'application/pdf' ? 'PDF' : mimeType.includes('image') ? 'image' : 'document'} and wants to know what fields they should extract from documents like this.

Inspect the document text below and propose a list of fields. For each field, return:
  {
    "name": "snake_case_name",
    "label": "Human-friendly label",
    "type": "string" | "number" | "date" | "currency" | "email" | "phone" | "line_items",
    "required": true | false,
    "description": "What to look for in the document",
    "sample": "Example value from THIS document if visible, else empty string"
  }

If the document contains line items (e.g. an invoice), include a field of type "line_items"
with a "subFields" array listing the per-line columns (e.g. description, quantity, unit_price, line_total).

Return ONLY a JSON array of field objects — no markdown fences, no commentary.`

    const completion = await z.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Document text:\n\n${text}` },
      ],
      thinking: { type: 'disabled' },
    })

    const raw = completion.choices[0]?.message?.content ?? ''
    const parsed = parseLlmJsonOrArray(raw)
    const suggestedFields = Array.isArray(parsed) ? parsed as FieldDef[] : []

    return NextResponse.json({
      suggested_fields: suggestedFields,
      text_length: text.length,
      detected_doc_type: detectDocType(text),
    })
  } catch (e) {
    console.error('[analyse] error:', e)
    return NextResponse.json({ error: { code: 'INTERNAL', message: e instanceof Error ? e.message : 'Unknown' } }, { status: 500 })
  }
}
