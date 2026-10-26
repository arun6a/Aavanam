/**
 * Export utilities — convert extracted data to JSON, CSV, and XLSX.
 *
 * Per BRD §6.5 / §15 — JSON export is the structured result; CSV and XLSX
 * flatten for spreadsheet use. For invoices with line_items:
 *   - CSV: one row per line item with doc-level fields repeated
 *   - XLSX: TWO sheets — "Document Summary" (doc-level fields) + "Line Items"
 *     (one row per line item with doc-level fields repeated for context)
 */

import * as XLSX from 'xlsx'
import type { TemplateDef } from '@/lib/templates/schema'

export type ExportFormat = 'json' | 'csv' | 'xlsx'

export function exportJson(data: Record<string, unknown>): string {
  return JSON.stringify(data, null, 2)
}

/**
 * Flatten data for CSV. If line_items exist, generate a CSV where each row
 * is a line item, prefixed with the document-level fields.
 */
export function exportCsv(
  data: Record<string, unknown>,
  template: TemplateDef,
): string {
  const docFields = template.fields.filter(f => f.type !== 'line_items')
  const lineItemsField = template.fields.find(f => f.type === 'line_items')

  const docHeaders = docFields.map(f => f.name)
  const lineHeaders: string[] = lineItemsField
    ? (lineItemsField.subFields ?? []).map(sf => `line_${sf.name}`)
    : []
  const allHeaders = [...docHeaders, ...lineHeaders]
  const headerRow = allHeaders.join(',')

  const docValues = docFields.map(f => csvEscape(data[f.name]))
  const lines: string[] = []

  const items = lineItemsField ? (data[lineItemsField.name] as Array<Record<string, unknown>> | undefined) : undefined
  if (Array.isArray(items) && items.length > 0) {
    for (const item of items) {
      const lineValues = (lineItemsField?.subFields ?? []).map(sf =>
        csvEscape(item?.[sf.name]),
      )
      lines.push([...docValues, ...lineValues].join(','))
    }
  } else {
    lines.push([...docValues, ...lineHeaders.map(() => '')].join(','))
  }

  return [headerRow, ...lines].join('\n')
}

/**
 * XLSX export with TWO sheets:
 *   1. "Document Summary" — one row with all doc-level fields
 *   2. "Line Items" — one row per line item with doc-level fields repeated
 *      for context (so the receiver can sort/filter without losing context)
 */
export function exportXlsx(
  data: Record<string, unknown>,
  template: TemplateDef,
): Buffer {
  const wb = XLSX.utils.book_new()

  const docFields = template.fields.filter(f => f.type !== 'line_items')
  const lineItemsField = template.fields.find(f => f.type === 'line_items')

  // ── Sheet 1: Document Summary ─────────────────────────────────────────
  const summaryData = docFields.map(f => ({
    Field: f.name,
    Label: f.label,
    Value: formatForCell(data[f.name]),
  }))
  const summarySheet = XLSX.utils.json_to_sheet(summaryData, {
    header: ['Field', 'Label', 'Value'],
  })
  // Set column widths
  ;(summarySheet as { '!cols'?: { wch: number }[] })['!cols'] = [
    { wch: 22 }, { wch: 26 }, { wch: 50 },
  ]
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Document Summary')

  // ── Sheet 2: Line Items ────────────────────────────────────────────────
  if (lineItemsField) {
    const items = data[lineItemsField.name] as Array<Record<string, unknown>> | undefined
    const docHeaders = docFields.map(f => f.name)
    const lineHeaders = (lineItemsField.subFields ?? []).map(sf => sf.name)
    const allHeaders = [...docHeaders, ...lineHeaders]

    if (Array.isArray(items) && items.length > 0) {
      const rows = items.map(item => {
        const row: Record<string, unknown> = {}
        // Repeat doc-level fields
        for (const f of docFields) {
          row[f.name] = formatForCell(data[f.name])
        }
        // Per-line fields
        for (const sf of lineItemsField.subFields ?? []) {
          row[sf.name] = formatForCell(item?.[sf.name])
        }
        return row
      })
      const lineSheet = XLSX.utils.json_to_sheet(rows, { header: allHeaders })
      XLSX.utils.book_append_sheet(wb, lineSheet, 'Line Items')
    } else {
      // Empty sheet with headers
      const emptySheet = XLSX.utils.json_to_sheet([], { header: allHeaders })
      XLSX.utils.book_append_sheet(wb, emptySheet, 'Line Items')
    }
  }

  // Generate as Buffer
  const arrayBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer
  return Buffer.from(arrayBuffer)
}

/** Set Content-Disposition headers for the response. */
export function downloadFilename(original: string, ext: ExportFormat): string {
  const base = original.replace(/\.[^.]+$/, '')
  return `${base}.${ext}`
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/** Format a value for XLSX cells — keeps numbers/strings/dates as their native type. */
function formatForCell(value: unknown): string | number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  // Arrays / objects → JSON string (so they don't get split across cells)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
