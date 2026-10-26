/**
 * Schema validation per BRD §5.2 — "Run deterministic checks such as date format,
 * numeric types, line totals and required fields."
 *
 * Reports:
 *   - is_valid:       boolean — true if no issues
 *   - missing_fields: string[] — required fields not in extracted data
 *   - issues:        { field, type, message }[]
 *
 * Type validation (number, date, currency, email, phone) is best-effort —
 * we report type mismatches but don't coerce.
 */

import type { TemplateDef, FieldDef } from '@/lib/templates/schema'

export type ValidationIssue = {
  field: string
  type: 'missing' | 'wrong_type' | 'invalid_date' | 'invalid_email' | 'invalid_phone' | 'line_item_issue'
  message: string
}

export type ValidationResult = {
  is_valid: boolean
  missing_fields: string[]
  issues: ValidationIssue[]
}

export function validateExtraction(
  data: Record<string, unknown>,
  template: TemplateDef,
): ValidationResult {
  const issues: ValidationIssue[] = []
  const missing_fields: string[] = []

  for (const field of template.fields) {
    const value = data[field.name]

    if (value === undefined || value === null) {
      if (field.required) {
        missing_fields.push(field.name)
        issues.push({
          field: field.name,
          type: 'missing',
          message: `Required field "${field.label}" is missing`,
        })
      }
      continue
    }

    // Type-check
    if (field.type === 'line_items') {
      if (!Array.isArray(value)) {
        issues.push({
          field: field.name,
          type: 'line_item_issue',
          message: `${field.label} should be an array`,
        })
      } else {
        // Validate each line item
        for (let i = 0; i < value.length; i++) {
          const item = value[i]
          if (typeof item !== 'object' || item === null) {
            issues.push({
              field: `${field.name}[${i}]`,
              type: 'line_item_issue',
              message: `Line item ${i + 1} is not an object`,
            })
            continue
          }
          for (const sf of field.subFields ?? []) {
            const subValue = (item as Record<string, unknown>)[sf.name]
            if (subValue === undefined || subValue === null) {
              if (sf.required) {
                issues.push({
                  field: `${field.name}[${i}].${sf.name}`,
                  type: 'missing',
                  message: `Required sub-field "${sf.label}" is missing on line ${i + 1}`,
                })
              }
            } else {
              const typeIssue = checkType(subValue, sf.type)
              if (typeIssue) {
                issues.push({
                  field: `${field.name}[${i}].${sf.name}`,
                  type: 'wrong_type',
                  message: typeIssue,
                })
              }
            }
          }
        }
      }
      continue
    }

    const typeIssue = checkType(value, field.type)
    if (typeIssue) {
      issues.push({
        field: field.name,
        type: typeIssue.includes('date') ? 'invalid_date'
          : typeIssue.includes('email') ? 'invalid_email'
          : typeIssue.includes('phone') ? 'invalid_phone'
          : 'wrong_type',
        message: typeIssue,
      })
    }
  }

  return {
    is_valid: issues.length === 0,
    missing_fields,
    issues,
  }
}

function checkType(value: unknown, type: FieldDef['type']): string | null {
  switch (type) {
    case 'string':
      return typeof value === 'string' ? null : `Expected string, got ${typeof value}`
    case 'number':
      return typeof value === 'number' && !isNaN(value)
        ? null
        : `Expected number, got ${typeof value} (${String(value)})`
    case 'currency':
      // Currency is a number per our schema; if LLM returns "$1,234.56", we report it
      if (typeof value === 'number') return null
      if (typeof value === 'string') {
        const cleaned = value.replace(/[$,\s]/g, '')
        const n = Number(cleaned)
        if (!isNaN(n)) return null  // looks numeric after cleanup, accept
        return `Expected currency (number), got "${value}"`
      }
      return `Expected currency (number), got ${typeof value}`
    case 'date':
      if (typeof value !== 'string') return `Expected date string (YYYY-MM-DD), got ${typeof value}`
      return /^\d{4}-\d{2}-\d{2}$/.test(value) || /^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$/.test(value)
        ? null
        : `Expected date in YYYY-MM-DD format, got "${value}"`
    case 'email':
      if (typeof value !== 'string') return `Expected email string, got ${typeof value}`
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
        ? null
        : `Invalid email format: "${value}"`
    case 'phone':
      if (typeof value !== 'string') return `Expected phone string, got ${typeof value}`
      return /^[\d\s()+\-]{7,20}$/.test(value)
        ? null
        : `Invalid phone format: "${value}"`
    case 'line_items':
      return null  // handled above
    default:
      return null
  }
}
