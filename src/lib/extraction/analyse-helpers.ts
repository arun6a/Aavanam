/**
 * Helpers for the /api/analyse endpoint — extracted so they're testable.
 */

import type { FieldDef } from '@/lib/templates/schema'

/** Tries to parse either a JSON array or a {fields: [...]} wrapper. */
export function parseLlmJsonOrArray(raw: string): unknown {
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

export function detectDocType(text: string): string {
  const t = text.toLowerCase()
  if (t.includes('gst') && t.includes('gstin')) return 'indian_gst_invoice'
  if (t.includes('invoice') || t.includes('bill to')) return 'invoice'
  if (t.includes('receipt')) return 'receipt'
  if (t.includes('purchase order') || t.includes('po number')) return 'purchase_order'
  if (t.includes('packing slip') || t.includes('tracking number')) return 'packing_slip'
  if (t.includes('quotation') || t.includes('quote')) return 'quotation'
  if (t.includes('payslip') || t.includes('salary slip')) return 'payslip'
  if (t.includes('bank statement')) return 'bank_statement'
  return 'unknown'
}
