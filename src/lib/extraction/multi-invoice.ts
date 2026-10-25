/**
 * Multi-invoice detection.
 *
 * Per BRD §5.2 — inspect PDF text quality. Some PDFs (especially Indian
 * GST "annexure" invoices) bundle multiple tax invoices in one document.
 * We detect this by scanning for repeated invoice-number markers, then
 * split the text into per-invoice chunks before extraction.
 *
 * Approach: send a small "splitter" prompt to the LLM asking it to identify
 * the boundaries of each invoice in the text. The LLM returns an array of
 * { invoice_marker, start_index, end_index } that we use to slice the text.
 *
 * Falls back to a single chunk if detection fails or only one invoice is found.
 */

import ZAI from 'z-ai-web-dev-sdk'

export type InvoiceChunk = {
  /** Marker that identifies this invoice (e.g. "CB/2026-27/011 (MATERIAL)"). */
  marker: string
  /** The text portion for this invoice. */
  text: string
  /** Index in the original text where this chunk starts. */
  startIndex: number
  /** Index in the original text where this chunk ends (exclusive). */
  endIndex: number
}

/**
 * Quick heuristic check: count occurrences of common invoice-number markers
 * in the text. If we see 2+ markers, the document likely has multiple invoices.
 */
export function hasMultipleInvoiceMarkers(text: string): boolean {
  const patterns = [
    /\bInvoice\s*No[:\s]/gi,
    /\bInvoice\s*Number[:\s]/gi,
    /\bTax\s*Invoice\s*No[:\s]/gi,
    /\bANNEXURE\s*(?:OF\s*)?TAX\s*INVOICE/gi,
    /\bINV\.?\s*NO\.?\s*[:\s]/gi,
  ]
  let count = 0
  for (const p of patterns) {
    const matches = text.match(p)
    if (matches) count += matches.length
  }
  return count >= 2
}

/**
 * Use the LLM to split text into per-invoice chunks. Returns one chunk per
 * detected invoice. If only one invoice found (or detection fails), returns
 * an array with a single chunk = the original text.
 *
 * The LLM is given the text and asked to return:
 *   [
 *     { "marker": "CB/2026-27/011 (MATERIAL)", "start_phrase": "Invoice No: CB/2026-27/011", "end_phrase": "Invoice No: CB/2026-27/012" },
 *     { "marker": "CB/2026-27/012 (SERVICE)", "start_phrase": "Invoice No: CB/2026-27/012", "end_phrase": "<end>" }
 *   ]
 * We then locate each start_phrase and end_phrase in the original text to slice.
 */
export async function splitMultiInvoiceText(text: string): Promise<InvoiceChunk[]> {
  // Heuristic check first — save LLM call cost when text only has 1 invoice
  if (!hasMultipleInvoiceMarkers(text)) {
    return [{ marker: '(single)', text, startIndex: 0, endIndex: text.length }]
  }

  try {
    const zai = await ZAI.create()
    const systemPrompt = `You are a document analysis assistant. The user has uploaded a document that may contain multiple invoices bundled together (common in Indian GST annexure-style tax invoices).

Inspect the document text below. If it contains multiple invoices, identify the boundary of each by finding the start phrase and end phrase for each one. Return a JSON array of objects:

[
  {
    "marker": "the invoice number or distinctive identifier",
    "start_phrase": "the exact phrase from the text that begins this invoice section (a unique string of at least 20 chars, e.g. 'Invoice No: CB/2026-27/011')",
    "end_phrase": "the exact phrase from the text that begins the NEXT invoice section, OR '<end>' if this is the last invoice"
  }
]

Rules:
- Return ONLY valid JSON — no prose, no markdown fences.
- The start_phrase MUST be a verbatim substring of the text (case-sensitive).
- Each start_phrase should be unique within the text.
- If the document contains only one invoice, return [{ "marker": "(single)", "start_phrase": "", "end_phrase": "<end>" }].
- If you cannot determine boundaries confidently, return [{ "marker": "(single)", "start_phrase": "", "end_phrase": "<end>" }].`

    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Document text:\n\n${text}` },
      ],
      thinking: { type: 'disabled' },
    })

    const raw = completion.choices[0]?.message?.content ?? ''
    const parsed = parseJsonArray(raw)

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [{ marker: '(single)', text, startIndex: 0, endIndex: text.length }]
    }

    // If only one entry with empty start_phrase, treat as single
    if (parsed.length === 1 && !parsed[0].start_phrase) {
      return [{ marker: '(single)', text, startIndex: 0, endIndex: text.length }]
    }

    // Locate each chunk by start_phrase / end_phrase
    const chunks: InvoiceChunk[] = []
    for (let i = 0; i < parsed.length; i++) {
      const entry = parsed[i]
      const startPhrase: string = entry.start_phrase ?? ''
      const endPhrase: string = entry.end_phrase ?? '<end>'
      const marker: string = entry.marker ?? `(invoice ${i + 1})`

      // Find start
      let startIdx = 0
      if (startPhrase && startPhrase.length >= 5) {
        startIdx = text.indexOf(startPhrase)
        if (startIdx === -1) {
          // Try case-insensitive fallback
          startIdx = text.toLowerCase().indexOf(startPhrase.toLowerCase())
        }
      }
      if (startIdx === -1) startIdx = 0

      // Find end (in next chunk's start_phrase) or text end
      let endIdx = text.length
      if (endPhrase && endPhrase !== '<end>') {
        endIdx = text.indexOf(endPhrase, startIdx + 1)
        if (endIdx === -1) {
          endIdx = text.toLowerCase().indexOf(endPhrase.toLowerCase(), startIdx + 1)
        }
        if (endIdx === -1) endIdx = text.length
      }

      chunks.push({
        marker,
        text: text.slice(startIdx, endIdx).trim(),
        startIndex: startIdx,
        endIndex: endIdx,
      })
    }

    return chunks
  } catch (e) {
    console.error('[multi-invoice-detect] failed, falling back to single:', e)
    return [{ marker: '(single)', text, startIndex: 0, endIndex: text.length }]
  }
}

function parseJsonArray(raw: string): unknown[] {
  try { return JSON.parse(raw) } catch {}
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) {
    try { return JSON.parse(fence[1].trim()) } catch {}
  }
  const arrStart = raw.indexOf('[')
  const arrEnd = raw.lastIndexOf(']')
  if (arrStart !== -1 && arrEnd > arrStart) {
    try { return JSON.parse(raw.slice(arrStart, arrEnd + 1)) } catch {}
  }
  return []
}
