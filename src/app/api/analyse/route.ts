/**
 * POST /api/analyse
 *   multipart/form-data:
 *     file: PDF/PNG/JPG (sample document)
 *   Returns: AI-suggested field definitions to seed the template builder.
 *
 * Per BRD §3 US-03 — "System proposes fields with types and sample values;
 * user can edit all suggestions."
 */

import { NextRequest, NextResponse } from 'next/server'
import { fileTypeFromBuffer } from 'file-type'

import { extractPdfText } from '@/lib/pdf/extract'
import { runOcrEngines } from '@/lib/ocr'
import { getLlmAdapter } from '@/lib/extraction/extractor'
import { parseLlmJson } from '@/lib/extraction/extractor'
import type { FieldDef } from '@/lib/templates/schema'

const MAX_SIZE = 10 * 1024 * 1024
const ALLOWED = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp']

export async function POST(req: NextRequest) {
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

    const llm = getLlmAdapter()
    const zai = await (await import('z-ai-web-dev-sdk')).default.create()

    const systemPrompt = `You are a document analysis assistant. The user has uploaded a sample ${mimeType === 'application/pdf' ? 'PDF' : 'image'} and wants to know what fields they should extract from documents like this.

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

    const completion = await zai.chat.completions.create({
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

/** Tries to parse either a JSON array or a {fields: [...]} wrapper. */
function parseLlmJsonOrArray(raw: string): unknown {
  // Try as-is first
  try { return JSON.parse(raw) } catch {}
  // Unwrap markdown
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) {
    try { return JSON.parse(fence[1].trim()) } catch {}
  }
  // Find the largest [...] or {...} block
  const arrStart = raw.indexOf('[')
  const arrEnd = raw.lastIndexOf(']')
  const objStart = raw.indexOf('{')
  const objEnd = raw.lastIndexOf('}')
  if (arrStart !== -1 && arrEnd > arrStart) {
    try { return JSON.parse(raw.slice(arrStart, arrEnd + 1)) } catch {}
  }
  if (objStart !== -1 && objEnd > objStart) {
    try { return JSON.parse(raw.slice(objStart, objEnd + 1)) } catch {}
  }
  return []
}

function detectDocType(text: string): string {
  const t = text.toLowerCase()
  if (t.includes('invoice') || t.includes('bill to')) return 'invoice'
  if (t.includes('receipt')) return 'receipt'
  if (t.includes('purchase order') || t.includes('po number')) return 'purchase_order'
  if (t.includes('packing slip') || t.includes('tracking number')) return 'packing_slip'
  if (t.includes('quotation') || t.includes('quote')) return 'quotation'
  return 'unknown'
}
