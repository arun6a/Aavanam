# Aavanam — Current Stage (Day 1 + Day 2 Complete)

**Last updated**: 2026-10-26
**Live preview**: https://preview-z-ai.space-z.ai/
**Status**: MVP vertical slice shipped. ~25–30% of target architecture.

---

## What's running

A Next.js 16 + TypeScript + Prisma (SQLite) web app on the Z.ai preview
environment. Three tabs (Extract / Template / History). Two starter templates
seeded (Invoice basic + Indian GST Invoice). Tested end-to-end against real
Indian GST tax invoices from the project sponsor.

## What's been built (by BRD milestone)

| BRD Milestone | Status | Notes |
|---|---|---|
| **M0** — Discovery & evaluation set | ✅ | Sponsor's real BioGas Plant invoices ARE the golden set |
| **M1** — Repo + skeleton | ✅ | Next.js 16 + Tailwind 4 + shadcn/ui + Prisma + TS |
| **M2** — Upload + raw parsing | ✅ | File validation (type/size via file-type), unpdf text extraction, scanned-PDF detection |
| **M3** — OCR + job lifecycle | ✅ | Tesseract 5 via system CLI (--psm 4), sync job API (no queue yet) |
| **M4** — Invoice extraction | ✅ | Starter template (11 fields) + Indian GST template (26 fields + 11 sub-fields) |
| **M5** — Template builder | ✅ | CRUD ✓, schema editor ✓, **AI field suggestion ✓** (via /api/analyse + AnalyseSampleButton) |
| **M6** — Public API integration | ❌ | API key flow, async job polling, SDK docs — deferred |
| **M7** — Exports + history | ⚠️ partial | JSON ✓ CSV ✓ history ✓; **XLSX deferred** |
| **M8** — Cloud deployment | ❌ | Still on Z.ai preview (intentional — friend deploys to GCP later) |
| **M9** — Pilot & fixes | 🔄 | In progress — Day 1+2 were the pilot |

## Architecture components implemented

### Frontend (Next.js 16 + React 19 + TypeScript)
- `src/app/page.tsx` — single-page app with 3 tabs (Extract / Template / History)
- `src/components/extraction/upload-panel.tsx` — drag-drop upload zone with file validation
- `src/components/extraction/result-panel.tsx` — extraction result view, **multi-invoice aware** (renders DocumentBlock per invoice)
- `src/components/extraction/template-editor.tsx` — full schema editor: name, instructions, fields with type/required/description/sample, line_items sub-field editor
- `src/components/extraction/job-history.tsx` — job list with status badges, OCR engine badges, per-job download buttons
- `src/components/extraction/engine-compare.tsx` — Tesseract 5 vs PaddleOCR side-by-side panel
- `src/components/extraction/analyse-sample-button.tsx` — AI field suggestion dialog (2-step flow: upload → review/edit → create template)

### Backend (Next.js API routes)
- `src/app/api/extract/route.ts` — POST: file validation → PDF parse OR image OCR → multi-invoice detection → LLM extraction → schema validation → persist. Accepts `multiInvoice` form-data flag (auto | on | off).
- `src/app/api/analyse/route.ts` — POST: upload sample → AI suggests fields
- `src/app/api/templates/route.ts` — GET (list), POST (create), PUT (seed bundled templates)
- `src/app/api/templates/[id]/route.ts` — GET, PATCH, DELETE
- `src/app/api/jobs/route.ts` — GET (list)
- `src/app/api/jobs/[id]/route.ts` — GET (detail), DELETE
- `src/app/api/jobs/[id]/export/route.ts` — GET (JSON or CSV download)

### Lib modules
- `src/lib/db.ts` — Prisma client singleton
- `src/lib/ocr/index.ts` — provider-neutral OcrAdapter interface + TesseractAdapter (system CLI, --psm 4) + PaddleAdapter (stub — needs Python worker)
- `src/lib/pdf/extract.ts` — unpdf text extraction with is_scanned heuristic
- `src/lib/extraction/extractor.ts` — LLM adapter interface + ZaiLlmAdapter (auto-splits large templates into 2 parallel calls) + OpenAiLlmAdapter (ready to drop in at test time)
- `src/lib/extraction/multi-invoice.ts` — heuristic + LLM-based invoice boundary detection
- `src/lib/templates/schema.ts` — FieldDef/TemplateDef types + STARTER_INVOICE_TEMPLATE + INDIAN_GST_INVOICE_TEMPLATE + BUNDLED_TEMPLATES + JSON Schema generator
- `src/lib/validation/validate.ts` — schema validation: missing required fields, type mismatches, invalid dates/emails/phones, line_item sub-field validation
- `src/lib/export/export.ts` — JSON + CSV export (CSV flattens line_items, one row per item)

### Database (Prisma schema)
- `prisma/schema.prisma` — Template, Job, Setting models (SQLite; structurally identical to PostgreSQL for later migration)

## Real-world test results (sponsor's actual invoices)

| Test | Result | Time |
|---|---|---|
| INV.011+012 with starter template | 11 fields extracted, all 37 line items | 24s |
| INV.013 with starter template | All fields + 5 line items + GST math correct | 4.7s |
| INV.011+012 with Indian GST template (single LLM call) | Empty data — Z.ai LLM hit schema-size limit | 47s |
| INV.011+012 with Indian GST template (split LLM calls) | ✅ 26/26 fields, 37 line items with material/service split, validation passed | 38s |
| INV.011+012 with multi-invoice detector | ✅ 2 invoices detected, doc 1 fully extracted, doc 2 minimal (correct — PDF only has 3 lines for 012) | 38s |

### Key accuracy wins on real Indian GST invoices
- Vendor GSTIN: `09AAMCR5771Q1ZA` ✓
- Vendor PAN: `AAMCR5771Q` ✓
- Bill-to GSTIN: `33AAOCR6063P1ZO` ✓
- Contract No: `2026-27_05_T1_S9_1333` ✓
- CO Value: `750000000` (75 crore) ✓
- Milestone: `BioGas Plant Milestone No. 4: Project Engineering Completion` ✓
- Total in words: matches exactly ("Indian Rupees Four Crores Nine Lakhs Fifty Two Thousand Three Hundred Only") ✓
- Subtotal `28666610`, tax `12285690`, total `40952300` — math correct ✓
- All 37 line items with material_amount + service_amount split ✓

## Performance characteristics

- **PDF text extraction**: ~50–300ms (unpdf, no worker needed)
- **Tesseract OCR**: ~1s for a 1241×1754 PNG
- **LLM extraction (Z.ai GLM-4)**: ~600ms per line item. 4-5s for a small invoice, 24-38s for a 37-line-item invoice
- **OpenAI gpt-4o-mini** (drop-in via OpenAiLlmAdapter): expected 5–10× faster

## What's NOT done (the gap to the target architecture)

### Module 1 — Product identity ❌
The architecture diagram calls the product **"Aavanam"**. The app currently says "AI Document Extraction Platform". Needs rebrand.

### Module 2 — API Gateway & Authentication ❌
- ❌ JWT / API Key auth (NextAuth.js is installed but not used)
- ❌ Rate limiting
- ❌ Request validation middleware
- ❌ Routing layer

### Module 3 — User & Organization Management ❌
- ❌ User registration/login
- ❌ Organization (tenant) model
- ❌ Roles: Admin / Company User / API User
- ❌ Multi-tenant data isolation
- ❌ API Keys UI (generate, revoke, view usage)

### Module 4 — Public API for external consumers ❌
- ❌ API Builder UI
- ❌ API documentation page (curl examples, error codes)
- ❌ Public API endpoints (`/api/v1/*`) for ERP/Accounting/Mobile/BPM integration
- ❌ Async job API (submit → poll for status)
- ❌ Webhook notifications on completion

### Module 5 — Async Job Queue ❌
- ❌ Cloud Tasks / Pub/Sub
- ❌ Background workers
- ❌ Retry on failure
- ❌ Status updates via polling
- ❌ Webhook callbacks

### Module 6 — Dashboard UI ❌
- ❌ Usage stats (jobs/week, success rate, by-template breakdown)
- ❌ Cost tracking (LLM tokens used, OCR cost)
- ❌ Recent activity feed

### Module 7 — Settings page ❌
- ❌ Profile settings
- ❌ API key management
- ❌ Webhook configuration
- ❌ Retention policies

### Module 8 — Layout Analysis & Table Extraction ⚠️ partial
We do flat text extraction (unpdf) + LLM extraction. The target calls for:
- ❌ Layout-aware extraction (column detection, reading order)
- ❌ Dedicated table extraction (we rely on LLM to parse tables from text — works but not optimal)

### Module 9 — Confidence Scoring ⚠️ partial
- ✅ OCR confidence (Tesseract TSV gives per-word confidence)
- ❌ LLM field-level confidence (e.g. "I'm 95% sure this is the invoice number")
- ❌ Per-field review flags ("review_required" if confidence < threshold)

### Module 10 — Additional file formats ⚠️ partial
- ✅ PDF, PNG, JPG
- ❌ TIFF, DOCX, XLSX (the architecture diagram shows all 5 supported)

### Module 11 — Webhook Notifications ❌
- ❌ Webhook registration UI
- ❌ Webhook signing (HMAC)
- ❌ Retry policy on webhook failure

### Module 12 — Audit Logs ❌
- ❌ Track who-did-what (template edited, key revoked, job deleted)
- ❌ Compliance-ready audit trail

### Module 13 — Cloud Deployment ❌
- ❌ Google Cloud Run deployment
- ❌ Google Cloud Storage for files
- ❌ Google Secret Manager for keys
- ❌ Cloud Logging / monitoring / alerting
- ❌ Production-ready IAM

## Honest scope assessment

What we built is the **single-user MVP slice** — about 25-30% of the target.
The architecture diagram describes a **production multi-tenant SaaS** that
would take 8-12 weeks (per the BRD's own estimate) plus another 4-6 weeks
for the cloud/deployment phase.

## Test data

- `/upload/sample-invoices/` — 3 generated sample invoice PDFs (Acme, TechSupplies, ZenithServices) + 1 PNG (Acme as image) for OCR testing
- `/upload/ANNEXURE INV.NO.011,012 (2).pdf` — sponsor's real BioGas Plant milestone 4 invoice (multi-invoice: 011 MATERIAL + 012 SERVICE)
- `/upload/ANNEXURE INV.NO.013 MILESTONE NO.7 -Material (1).pdf` — sponsor's real BioGas Plant milestone 7 invoice (single, GST 5%)
- `/upload/IMG-20261025-WA0003.jpg` — sponsor's architecture diagram showing the "Aavanam" target product
