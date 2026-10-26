# Regex-Based Extraction Rules — Design Document

**Status**: Proposed (not yet implemented)
**Date**: 2026-10-26
**Goal**: Reduce AI cost + increase speed for repeated document formats

---

## Problem

Currently, every document extraction uses AI (LLM) to structure the OCR text:
```
Document → OCR → Raw Text → AI → Structured JSON
```

This costs ~$0.01 per document and takes 3-5 seconds. For high-volume usage
(hundreds of invoices per day from the same vendors), this is expensive and slow.

## Proposed Solution

Add a "rules engine" that can extract fields from OCR text using regex patterns
— no AI needed. Rules are saved per template and applied automatically.

### Hybrid approach (recommended)

```
Document → OCR → Raw Text
                       ↓
              ┌─ Has saved regex rules? ─┐
              │                          │
         YES  │                     NO  │
              ↓                          ↓
     Apply regex rules             Use AI (LLM)
     (fast, free)                 (slow, costs $0.01)
              ↓                          ↓
     Structured JSON              Structured JSON
              ↓                          ↓
              │                    Offer to save
              │                    rules from this
              │                    extraction
              └──────────┬───────────────┘
                         ↓
                    Return result
```

### Three document scenarios

**Case 1: Fixed-layout documents (rules work great)**
- Same vendor always sends the same invoice format
- Same positions, same labels, same column order
- Regex rules extract fields perfectly every time
- No AI needed → fast (<1 second) + free ($0)

**Case 2: Variable-layout documents (AI still needed)**
- Different vendors send different invoice formats
- Different positions, different labels
- Regex rules from Vendor A won't work for Vendor B
- AI is needed to understand each new layout

**Case 3: Semi-structured (hybrid — best of both)**
- 80% of documents come from the same few vendors (same format)
- 20% come from new/occasional vendors (different formats)
- Rules handle the 80% (fast, free)
- AI handles the 20% (slow, costs money)
- Total cost drops by ~80%, speed improves by ~80%

## Implementation: Approach 1 — Regex Rules (Recommended)

### Data model

Add `extractionRules` field to the Template model (JSON stored in DB):

```json
{
  "extraction_rules": [
    {
      "field": "invoice_number",
      "pattern": "Invoice No:\\s*(.+?)(?:\\s|$)",
      "group": 1,
      "description": "Extract invoice number after 'Invoice No:'"
    },
    {
      "field": "invoice_date",
      "pattern": "Invoice date:\\s*(\\d{2}/\\d{2}/\\d{4})",
      "group": 1,
      "transform": "date_dd_mm_yyyy_to_iso"
    },
    {
      "field": "vendor_gstin",
      "pattern": "GSTIN of Biller:\\s*([A-Z0-9]{15})",
      "group": 1
    },
    {
      "field": "total_amount",
      "pattern": "TOTAL:\\s*USD\\s*([\\d,]+\\.\\d{2})",
      "group": 1,
      "transform": "remove_commas"
    }
  ]
}
```

### Transforms supported

| Transform | Description |
|---|---|
| `remove_commas` | "1,234,567.89" → 1234567.89 |
| `date_dd_mm_yyyy_to_iso` | "12/09/2026" → "2026-09-12" |
| `date_mm_dd_yyyy_to_iso` | "09/12/2026" → "2026-09-12" |
| `to_number` | "123.45" → 123.45 |
| `trim` | "  value  " → "value" |

### Extraction flow

1. User uploads document
2. OCR extracts raw text (Tesseract or pdf-parse)
3. Check if template has `extraction_rules`
4. If YES:
   - Apply each regex pattern to the text
   - Extract matched groups
   - Apply transforms (date conversion, number parsing, etc.)
   - Build structured JSON
   - Validate against template schema
   - If all required fields found → return result (no AI!)
   - If some fields missing → fall back to AI for missing fields only
5. If NO:
   - Use AI (current behavior)
   - After extraction → offer to auto-generate rules from the result
6. Return result

### Rule auto-generation

After a successful AI extraction, the system can analyze the raw text + extracted
values and auto-generate regex rules:

1. For each extracted field, search the raw text for the value
2. Find the text pattern around the value (e.g., "Invoice No: CB-2026-013")
3. Generate a regex that captures the value after the label
4. Save rules to the template
5. Next time a similar document is uploaded → rules apply automatically

### UI changes

**Template Editor:**
- Add "Extraction Rules" section (collapsible)
- Shows saved regex rules per field
- "Auto-generate from last extraction" button
- "Test rules" button (apply rules to a sample document)

**Extract tab:**
- Show which method was used: "Rules (fast)" or "AI (fallback)"
- If rules were used, show a "Save these as rules" button after AI extraction

### API changes

- `POST /api/templates/{id}/rules` — save regex rules
- `GET /api/templates/{id}/rules` — get saved rules
- `POST /api/templates/{id}/rules/test` — test rules against a sample

## Other approaches considered

### Approach 2: Layout-based extraction
- Save X/Y coordinates of fields from first extraction
- Next time, look at the same coordinates
- Requires layout-aware PDF parsing (more complex)
- Not recommended for MVP — Approach 1 is simpler

### Approach 3: AI generates rules, then rules run
- First extraction: AI extracts + generates regex rules
- Subsequent: rules run (no AI)
- If rules fail: AI runs again + updates rules
- This is the "smartest" approach but most complex to build
- Can be built on top of Approach 1 later

## Trade-offs

| | Current (AI every time) | Proposed (Rules + AI fallback) |
|---|---|---|
| Speed | 3-5 seconds | <1 second (rules) / 3-5 seconds (AI fallback) |
| Cost | $0.01 per document | $0 for known formats / $0.01 for new formats |
| Accuracy | High (AI understands context) | High for known formats / medium for edge cases |
| Maintenance | None | Need to manage/update rules |
| Complexity | Simple | Medium |

## When to build this

- **Phase 1** (now): Ship the AI-only version, test with real documents
- **Phase 2** (next): Add regex rules engine for high-volume vendors
- **Phase 3** (future): Auto-generate rules from AI extractions

This feature becomes most valuable when the friend's customers process
100+ documents/day from the same few vendors. At that scale, the cost
savings ($0.01 × 100 × 0.8 = $0.80/day saved) and speed improvement
(100 documents × 4 seconds saved = 400 seconds/day) are meaningful.
