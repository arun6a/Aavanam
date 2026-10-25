/**
 * Export utilities — convert extracted data to JSON and CSV.
 *
 * Per BRD §6.5 / §15 — JSON export is the structured result; CSV export
 * flattens for spreadsheet use. For invoices with line_items, CSV has
 * two sections: a header row with document-level fields, then a
 * sub-table for line items.
 */

import type { TemplateDef } from '@/lib/templates/schema'

export type ExportFormat = 'json' | 'csv'

export function exportJson(data: Record<string, unknown>): string {
  return JSON.stringify(data, null, 2)
}

/**
 * Flatten data for CSV. If line_items exist, generate a CSV where each row
 * is a line item, prefixed with the document-level fields.
 *
 * Example columns: invoice_number, vendor_name, total_amount,
 *                  line_description, line_quantity, line_unit_price, line_line_total
 */
export function exportCsv(
  data: Record<string, unknown>,
  template: TemplateDef,
): string {
  const docFields = template.fields.filter(f => f.type !== 'line_items')
  const lineItemsField = template.fields.find(f => f.type === 'line_items')

  // Header
  const docHeaders = docFields.map(f => f.name)
  const lineHeaders: string[] = lineItemsField
    ? (lineItemsField.subFields ?? []).map(sf => `line_${sf.name}`)
    : []
  const allHeaders = [...docHeaders, ...lineHeaders]
  const headerRow = allHeaders.join(',')

  // Body
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

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/** Set Content-Disposition headers for the response. */
export function downloadFilename(original: string, ext: ExportFormat): string {
  const base = original.replace(/\.[^.]+$/, '')
  return `${base}.${ext}`
}
