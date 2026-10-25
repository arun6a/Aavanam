/**
 * PDF text extraction using unpdf — pure-JS, no worker dependency.
 *
 * Per BRD §5.2: "Inspect PDF text quality; use native parsing when text is
 * usable and OCR when pages are scanned."
 *
 * For MVP, "text is usable" = total extracted text length > 50 chars.
 * Production would check per-page text density + heuristics.
 */

import { extractText, getDocumentProxy } from 'unpdf'

export type PdfExtractResult = {
  text: string
  page_count: number
  text_length: number
  time_ms: number
  /** True if PDF has essentially no native text → needs OCR. */
  is_scanned: boolean
}

export async function extractPdfText(buffer: Buffer): Promise<PdfExtractResult> {
  const start = Date.now()
  // unpdf: load PDF from ArrayBuffer
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  // extractText walks all pages
  const result = await extractText(pdf, { mergePages: true })
  const text = (result?.text ?? '').trim()
  const text_length = text.length
  const is_scanned = text_length < 50
  const page_count = pdf.numPages ?? 1
  return {
    text,
    page_count,
    text_length,
    time_ms: Date.now() - start,
    is_scanned,
  }
}
