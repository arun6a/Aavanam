/**
 * Template field type definitions.
 *
 * A template is a list of field definitions. Each field has:
 *   - name:        short identifier (snake_case, used as JSON key)
 *   - label:       human-friendly display name
 *   - type:        data type — drives validation
 *   - required:    if true, missing field is reported as a validation issue
 *   - description: free-text instructions for the LLM (what to look for)
 *   - sample:      example value shown to LLM as guidance
 *
 * Type "line_items" is special — it's an array of line-item objects, each
 * containing the sub-fields listed in `subFields`. Used for invoice line items.
 */

export type FieldType =
  | 'string'
  | 'number'
  | 'date'
  | 'currency'
  | 'email'
  | 'phone'
  | 'line_items'

export interface FieldDef {
  name: string
  label: string
  type: FieldType
  required: boolean
  description?: string
  sample?: string
  /** Only for type === 'line_items' — sub-fields per line. */
  subFields?: Omit<FieldDef, 'subFields'>[]
}

export interface TemplateDef {
  id: string
  name: string
  documentType: string
  fields: FieldDef[]
  instructions?: string
}

/** Default starter invoice template — seeded into DB on first run. */
export const STARTER_INVOICE_TEMPLATE: Omit<TemplateDef, 'id'> = {
  name: 'Invoice (basic)',
  documentType: 'invoice',
  instructions:
    'Extract fields from this invoice. Use null for any field that is not present. ' +
    'For amounts, return plain numbers (no currency symbol). For dates, use ISO 8601 ' +
    '(YYYY-MM-DD). For line_items, return an array of objects with description, quantity, ' +
    'unit_price, and line_total — only include actual line items you can see.',
  fields: [
    { name: 'invoice_number', label: 'Invoice #', type: 'string', required: true,
      description: 'The invoice number, usually at top of document', sample: 'INV-001' },
    { name: 'invoice_date', label: 'Invoice Date', type: 'date', required: true,
      description: 'Date the invoice was issued', sample: '2026-10-25' },
    { name: 'due_date', label: 'Due Date', type: 'date', required: false,
      description: 'Date payment is due', sample: '2026-11-25' },
    { name: 'vendor_name', label: 'Vendor / Supplier', type: 'string', required: true,
      description: 'Name of the company issuing the invoice', sample: 'Acme Corp' },
    { name: 'vendor_email', label: 'Vendor Email', type: 'email', required: false,
      description: 'Vendor contact email', sample: 'billing@acme.com' },
    { name: 'bill_to', label: 'Bill To', type: 'string', required: false,
      description: 'Name of the customer being billed', sample: 'Globex Inc' },
    { name: 'subtotal', label: 'Subtotal', type: 'currency', required: false,
      description: 'Sum of line items before tax', sample: '1250.00' },
    { name: 'tax_amount', label: 'Tax', type: 'currency', required: false,
      description: 'Total tax amount', sample: '100.00' },
    { name: 'total_amount', label: 'Total', type: 'currency', required: true,
      description: 'Grand total of the invoice', sample: '1350.00' },
    { name: 'currency', label: 'Currency', type: 'string', required: false,
      description: 'Currency code (ISO 4217)', sample: 'USD' },
    {
      name: 'line_items',
      label: 'Line Items',
      type: 'line_items',
      required: false,
      description: 'Array of items billed on this invoice',
      subFields: [
        { name: 'description', label: 'Description', type: 'string', required: true,
          description: 'What the line item is', sample: 'Consulting service' },
        { name: 'quantity', label: 'Qty', type: 'number', required: false,
          description: 'Quantity billed', sample: '1' },
        { name: 'unit_price', label: 'Unit Price', type: 'currency', required: false,
          description: 'Price per unit', sample: '1250.00' },
        { name: 'line_total', label: 'Line Total', type: 'currency', required: true,
          description: 'Quantity × Unit Price', sample: '1250.00' },
      ],
    },
  ],
}

/**
 * Indian GST Invoice template — covers Indian tax invoices with GSTIN, PAN,
 * reverse charge, contract number, milestone-based billing, and per-line
 * GST rate. Tested on real BioGas Plant invoices (Renergy Dynamics Pvt Ltd).
 *
 * Use this template for documents that include "GSTIN", "Reverse Charge",
 * "PAN No", "ANNEXURE OF TAX INVOICE" markers — i.e. Indian GST tax invoices.
 */
export const INDIAN_GST_INVOICE_TEMPLATE: Omit<TemplateDef, 'id'> = {
  name: 'Indian GST Invoice',
  documentType: 'invoice',
  instructions:
    'Extract fields from this Indian GST tax invoice. Use null for any field not present. ' +
    'For amounts, return plain numbers (no currency symbol, no comma separators). ' +
    'For dates, convert DD/MM/YYYY → YYYY-MM-DD. For GSTIN, return exactly as printed ' +
    '(15-char alphanumeric). For PAN, return exactly as printed (10-char alphanumeric). ' +
    'For line_items, return one object per row in the billing annexure. Each row has ' +
    'description (the milestone/work description), quantity (usually 1), material_amount ' +
    '(pre-tax material value), service_amount (pre-tax service value, may be null), ' +
    'gst_rate (the GST percentage as a number like 5 or 18, null if no GST), gst_amount ' +
    '(the tax amount for this line, null if no GST), and line_total (the final total ' +
    'including any GST). Look for the "Sr." or "Pck No." column to identify line rows — ' +
    'skip header rows, totals rows, and separator rows.',
  fields: [
    { name: 'invoice_number', label: 'Invoice Number', type: 'string', required: true,
      description: 'The invoice number (e.g. CB/2026-27/011). Include suffix like (MATERIAL) or (SERVICE) if present.',
      sample: 'CB/2026-27/011 (MATERIAL)' },
    { name: 'invoice_date', label: 'Invoice Date', type: 'date', required: true,
      description: 'Invoice issue date. Convert DD/MM/YYYY → YYYY-MM-DD.',
      sample: '2026-08-18' },
    { name: 'date_of_service', label: 'Date of Service', type: 'date', required: false,
      description: 'Date the service was rendered, if separately mentioned (often earlier than invoice_date).',
      sample: '2026-08-17' },
    { name: 'vendor_name', label: 'Vendor / Supplier', type: 'string', required: true,
      description: 'Name of the company issuing the invoice (top of document, in the header).',
      sample: 'RENERGY DYNAMICS PRIVATE LIMITED' },
    { name: 'vendor_gstin', label: 'Vendor GSTIN', type: 'string', required: true,
      description: 'GSTIN of the biller (15-char alphanumeric, ends with Z + 1 char). Look for "GSTIN of Biller:" or similar.',
      sample: '09AAMCR5771Q1ZA' },
    { name: 'vendor_pan', label: 'Vendor PAN', type: 'string', required: false,
      description: 'PAN of the biller (10-char alphanumeric). Look for "PAN:" or "PAN No:".',
      sample: 'AAMCR5771Q' },
    { name: 'vendor_email', label: 'Vendor Email', type: 'email', required: false,
      description: 'Vendor contact email, usually after "EMAIL:" label.',
      sample: 'ATUPE@RENERGYDYNAMICS.COM' },
    { name: 'vendor_phone', label: 'Vendor Phone', type: 'phone', required: false,
      description: 'Vendor contact phone, usually after "Mob:" label.',
      sample: '9626528390' },
    { name: 'vendor_address', label: 'Vendor Address', type: 'string', required: false,
      description: 'Full address of the vendor (registered office + billing office if different).',
      sample: 'Tower B, B-147, ATS Bouquet, Sector-132, Noida, Uttar Pradesh - 201304' },
    { name: 'bill_to_name', label: 'Bill To (Name)', type: 'string', required: true,
      description: 'Name of the customer being billed. Look under "Bill To:" section.',
      sample: 'REFEX CBG SPV (COIMBATORE) LIMITED' },
    { name: 'bill_to_gstin', label: 'Bill To GSTIN', type: 'string', required: false,
      description: 'GSTIN of the customer being billed. Look under "Bill To:" section.',
      sample: '33AAOCR6063P1ZO' },
    { name: 'bill_to_address', label: 'Bill To Address', type: 'string', required: false,
      description: 'Full address of the customer (place of supply).',
      sample: 'Municipal Dump Yard, Survey No. 501-504, Chettipalayam Road, Coimbatore West, Tamil Nadu - 600034' },
    { name: 'ship_to_name', label: 'Ship To (Name)', type: 'string', required: false,
      description: 'Name of the recipient if different from Bill To. Often same as Bill To for service invoices.',
      sample: 'REFEX CBG SPV (COIMBATORE) LIMITED' },
    { name: 'contract_number', label: 'Contract / PO Number', type: 'string', required: false,
      description: 'Contract or purchase order number, often labeled "Contract No:" or "PO No:".',
      sample: '2026-27_05_T1_S9_1333' },
    { name: 'co_value', label: 'Contract Order Value', type: 'currency', required: false,
      description: 'Total contract value mentioned on the invoice, often labeled "CO Value:".',
      sample: '750000000' },
    { name: 'milestone', label: 'Milestone / Billing Stage', type: 'string', required: false,
      description: 'The milestone or billing stage this invoice covers (e.g. "BioGas Plant Milestone No. 4").',
      sample: 'BioGas Plant Milestone No. 4: Project Engineering Completion' },
    { name: 'reverse_charge', label: 'Reverse Charge', type: 'string', required: false,
      description: 'YES or NO. Look for "Reverse Charge:" label.',
      sample: 'NO' },
    { name: 'transport_mode', label: 'Transport Mode', type: 'string', required: false,
      description: 'Transport mode if mentioned (often "N/A" for service invoices).',
      sample: 'N/A' },
    { name: 'vehicle_number', label: 'Vehicle Number', type: 'string', required: false,
      description: 'Vehicle number if mentioned (often "N/A" for service invoices).',
      sample: 'N/A' },
    { name: 'place_of_supply', label: 'Place of Supply', type: 'string', required: false,
      description: 'State/location of supply (often derived from Bill To address).',
      sample: 'Tamil Nadu' },
    { name: 'subtotal', label: 'Subtotal (Taxable)', type: 'currency', required: false,
      description: 'Sum of all line item taxable amounts (pre-tax). Often shown as "Total Taxable Amount".',
      sample: '28666610' },
    { name: 'tax_amount', label: 'Total Tax', type: 'currency', required: false,
      description: 'Total tax amount (GST). Sum of all line item gst_amount. May be 0 if reverse charge.',
      sample: '611100' },
    { name: 'total_amount', label: 'Total Invoice Value', type: 'currency', required: true,
      description: 'Grand total = subtotal + tax_amount. Often shown as "Total Invoice Value" or in words "Indian Rupees ... Only".',
      sample: '40952300' },
    { name: 'total_in_words', label: 'Total in Words', type: 'string', required: false,
      description: 'Amount in words as printed on the invoice.',
      sample: 'Indian Rupees Four Crores Nine Lakhs Fifty Two Thousand Three Hundred Only' },
    { name: 'currency', label: 'Currency', type: 'string', required: false,
      description: 'Currency code. For Indian invoices, default to "INR" if not specified.',
      sample: 'INR' },
    {
      name: 'line_items',
      label: 'Line Items',
      type: 'line_items',
      required: false,
      description: 'Array of billing rows from the annexure. One object per row. Skip header, totals, and separator rows.',
      subFields: [
        { name: 'sr_no', label: 'Sr. No.', type: 'number', required: false,
          description: 'Serial number from the Sr. column.', sample: '1' },
        { name: 'code', label: 'Item Code', type: 'string', required: false,
          description: 'The internal item code (e.g. "4.1", "5.13", "7.18") from the first column.', sample: '4.1' },
        { name: 'description', label: 'Description', type: 'string', required: true,
          description: 'The milestone/work description text. Include any sub-category (e.g. "Basic Engineering", "Anaerobic Digestion") if shown.', sample: 'Process flow Diagrams Basic Engineering' },
        { name: 'category', label: 'Category', type: 'string', required: false,
          description: 'Engineering phase or category (e.g. "Basic Engineering", "Detailed Engineering", "Pre-Treatment", "Gas Management System").', sample: 'Basic Engineering' },
        { name: 'quantity', label: 'Qty', type: 'number', required: false,
          description: 'Quantity billed (usually 1 for milestone billing).', sample: '1' },
        { name: 'type', label: 'Type', type: 'string', required: false,
          description: 'Material or Service. Often shown in a column.', sample: 'Material' },
        { name: 'material_amount', label: 'Material Amount', type: 'currency', required: false,
          description: 'Pre-tax material value for this line.', sample: '1400000' },
        { name: 'service_amount', label: 'Service Amount', type: 'currency', required: false,
          description: 'Pre-tax service value for this line. May be null for material-only lines.', sample: '600000' },
        { name: 'gst_rate', label: 'GST Rate (%)', type: 'number', required: false,
          description: 'GST percentage for this line (e.g. 5, 18). 0 or null if no GST applied.', sample: '5' },
        { name: 'gst_amount', label: 'GST Amount', type: 'currency', required: false,
          description: 'GST amount for this line (taxable × gst_rate / 100).', sample: '70000' },
        { name: 'line_total', label: 'Line Total', type: 'currency', required: true,
          description: 'Final total for this line including any GST. = material + service + gst_amount.', sample: '2000000' },
      ],
    },
  ],
}

/**
 * All bundled starter templates — seeded into the DB on first run.
 * Each covers a different invoice style; users can edit/duplicate them.
 */
export const BUNDLED_TEMPLATES: Omit<TemplateDef, 'id'>[] = [
  STARTER_INVOICE_TEMPLATE,
  INDIAN_GST_INVOICE_TEMPLATE,
]

/** Convert a TemplateDef to the JSON Schema that's sent to the LLM. */
export function templateToJsonSchema(t: TemplateDef): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const f of t.fields) {
    if (f.type === 'line_items') {
      const itemProps: Record<string, unknown> = {}
      const itemRequired: string[] = []
      for (const sf of f.subFields ?? []) {
        itemProps[sf.name] = jsonSchemaForType(sf.type, sf.description)
        if (sf.required) itemRequired.push(sf.name)
      }
      properties[f.name] = {
        type: 'array',
        description: f.description,
        items: {
          type: 'object',
          properties: itemProps,
          required: itemRequired,
          additionalProperties: false,
        },
      }
    } else {
      properties[f.name] = jsonSchemaForType(f.type, f.description)
    }
    if (f.required) required.push(f.name)
  }
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  }
}

function jsonSchemaForType(t: FieldType, description?: string): Record<string, unknown> {
  const base = { description }
  switch (t) {
    case 'string': return { type: 'string', ...base }
    case 'number': return { type: 'number', ...base }
    case 'date': return { type: 'string', format: 'date', ...base }
    case 'currency': return { type: 'number', ...base }
    case 'email': return { type: 'string', format: 'email', ...base }
    case 'phone': return { type: 'string', ...base }
    case 'line_items': return { type: 'array', ...base }
  }
}

/** Serialize a TemplateDef to JSON string for DB storage. */
export function serializeTemplateFields(fields: FieldDef[]): string {
  return JSON.stringify(fields)
}

/** Parse a JSON string back to FieldDef[]. */
export function deserializeTemplateFields(json: string): FieldDef[] {
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed as FieldDef[]
  } catch {
    return []
  }
}
