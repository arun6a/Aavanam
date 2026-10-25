# Aavanam — Business Requirements Document (BRD)

**Personal BRD, Technical Architecture, Development Backlog & Execution Runbook**
Prepared for a solo developer building and operating the product.
Version 1.0 | Proposed MVP baseline | 25 October 2026

> **Source**: This BRD was provided by the project sponsor as the foundational
> planning document. It is preserved verbatim in this repo as the source of
> truth for product scope, acceptance criteria, and the 10-milestone roadmap
> (M0–M9). All architecture, schema, and API contract decisions trace back to
> this document.

---

## How to Use This Document

This is a build guide for you as the product owner, architect, developer,
tester and initial operator. It is not a sales proposal, client BRD, or
multi-person delivery estimate. Treat it as a working baseline: implement one
vertical slice at a time, keep decisions in the decision log, and update
requirements when evidence from the proof of concept changes the plan.

| Your role | What you own |
|---|---|
| Product owner | Choose use cases, define fields, prioritize features and approve acceptance criteria. |
| Solution architect | Maintain boundaries, data flows, API contracts, security and deployment decisions. |
| Developer | Implement frontend, backend, processing workers, tests and migrations. |
| QA / evaluator | Build a labelled document test set, compare extraction results and prevent regressions. |
| Operator | Monitor errors/costs, rotate secrets, handle data deletion and maintain backups. |

### Recommended Working Rules
- Do not build every feature before validating extraction quality on real sample documents.
- Do not expose production API secrets in browser code, mobile applications or source control.
- Keep a small MVP and deploy working increments to a non-production environment.
- Use real, permissioned sample documents; redact sensitive details where practical.
- Make every major decision explicit: provider, retention, file limits, schema versioning and hosting.
- Do not promise 100% extraction accuracy. Measure quality by field and document type.

## 1. Product Definition and Personal Goal

Build a reusable document extraction service that accepts business documents,
extracts user-selected fields, validates them against a saved schema, and
returns structured JSON with optional CSV/XLSX exports. A user can create a
template by uploading sample documents, reviewing AI-suggested fields,
configuring field rules and testing the template. Once published, the
template can be called by other applications through an authenticated API.

**Product principle**: Build a document extraction engine with a configurable
API, not a generic PDF converter. PDF conversion and exports are supporting
capabilities; the main product is repeatable extraction into a customer-defined
schema.

## 2. MVP Scope — Build This First

| Priority | Capability | MVP definition | Defer until later |
|---|---|---|---|
| P0 | Upload and extraction | PDF, PNG, JPG/JPEG; validate size/type; parse digital PDFs; OCR scanned files; show status and result. | Large batch uploads, uncommon formats, real-time streaming. |
| P0 | Invoice extraction | Starter invoice template with header fields and line items. | All industry-specific invoice variants. |
| P0 | Custom template builder | Upload sample, suggest fields, edit names/types/required flags/instructions, save draft and test. | Visual drag-and-drop schema designer and advanced rules language. |
| P0 | JSON response | Schema-valid JSON with missing fields represented consistently and validation issues reported. | Custom output transformation scripting. |
| P0 | API integration | Customer-scoped API key, template ID/version, asynchronous job API, polling endpoint. | Many SDKs, public marketplace and complex OAuth client flows. |
| P1 | Exports | Download JSON and CSV; XLSX for summary and line-item tables. | DOCX and searchable PDF generation. |
| P1 | History | List jobs, status, timestamps and results, scoped to the current organization. | Advanced analytics and billing. |
| P1 | Security and operations | Authentication, tenant checks, secrets, quotas, logs, retention and deletion. | Formal certifications and enterprise deployment options. |

### Explicit non-goals for the first version
- Do not support every file type until the core pipeline is reliable.
- Do not train a foundation model from scratch.
- Do not let an AI-generated value silently trigger payment, accounting or approval actions.
- Do not build a billing platform until usage and customer demand justify it.
- Do not promise exact extraction from low-quality scans or layouts not represented in testing.

## 3. User Stories and Acceptance Criteria

| ID | User story | Acceptance criteria |
|---|---|---|
| US-01 | As a user, I can upload a document. | Supported file is accepted; unsupported/oversized/corrupt file receives a clear error. |
| US-02 | As a user, I can extract using a built-in invoice template. | Result shows document fields, line items, missing values and validation status. |
| US-03 | As a template designer, I can upload sample documents. | System proposes fields with types and sample values; user can edit all suggestions. |
| US-04 | As a template designer, I can publish a template. | Published version is immutable and can be selected by ID/version. |
| US-05 | As a developer, I can call the API. | Valid key + file + template returns job ID; polling returns result or error. |
| US-06 | As an organization admin, I can revoke a key. | Revoked key is rejected immediately or within a documented short propagation window. |
| US-07 | As a user, I can export results. | JSON and CSV download correctly; XLSX includes document summary and line items. |
| US-08 | As an operator, I can diagnose failures. | Job ID, request ID, safe error code, timestamps and retry history are available without logging sensitive content. |

## 4. Proposed Technology Stack

| Layer | Recommended choice | Reason / guardrail |
|---|---|---|
| Frontend | React / Next.js + TypeScript | Reusable components and typed API contracts. |
| Backend | Python + FastAPI + Pydantic | Typed request validation and good document/AI ecosystem. |
| PDF parsing | PyMuPDF first; pdfplumber for selected table/layout cases | Use native text before OCR; benchmark on your own files. |
| OCR | PaddleOCR or Tesseract | Pick after a quality, deployment complexity and latency test. |
| Document layout | Docling as an optional adapter | Add only where plain parsing/OCR loses reading order or tables. |
| AI extraction | Provider-neutral adapter for a model with structured-output support | Compare quality, privacy terms, latency and cost; never trust raw output. |
| Database | PostgreSQL | Organizations, users, templates, jobs and audit metadata. |
| Object storage | Google Cloud Storage | Private originals and exports with lifecycle rules. |
| Queue | Cloud Tasks or Pub/Sub | Use a queue for long jobs; choose one based on retry/fan-out needs. |
| Runtime | Google Cloud Run | Separate API and worker services; configure limits and IAM. |
| Secrets | Google Secret Manager | No secrets in source code or frontend environment variables. |
| Tests | pytest, API contract tests, frontend tests | Automate repeatable evaluation and regression tests. |
| CI/CD | GitHub Actions or chosen CI platform | Lint, test, build, scan and deploy through controlled environments. |

> These are recommendations, not mandatory vendor choices. Keep parser and
> AI-provider adapters replaceable so the product does not depend on one
> library or model.

## 5. Architecture and Service Boundaries

```
Browser UI (React / Next.js)
   |
   | HTTPS + user session
   v
FastAPI control/API service -------------------- PostgreSQL
   |                                              - organizations/users
   | - templates/schema versions                  - jobs/results metadata
   | - API key hashes/scopes
   |
   +---- private object storage (originals/exports)
   |
   +---- queue (Cloud Tasks or Pub/Sub)
   |
   v
   Processing worker
   |
   +-----------+------------+
   |           |            |
   PDF parser  OCR   Layout parser
   |           |            |
   +-----------+------------+
   |
   Normalized content
   |
   AI extraction adapter
   |
   JSON/schema validator
   |
   business checks/review flags
   |
   persist result + notify/poll
```

### 5.1 Separate the control plane and processing plane
- **Control plane**: accounts, organization membership, templates, schema
  versions, API keys, quotas and audit metadata.
- **Processing plane**: file validation, parsing, OCR, model calls,
  validation, exports and job status.
- Keep API services stateless; process long-running files in workers and store
  state in durable systems.
- Every record, object key, job and result must be scoped to the owning
  organization.

### 5.2 Processing pipeline
1. Authenticate the caller and authorize the organization, template and version.
2. Validate file size, file signature, allowed MIME type, page count and request quota.
3. Store the source file in a private bucket and create a durable job record.
4. Inspect PDF text quality; use native parsing when text is usable and OCR when pages are scanned.
5. Use layout/table parsing only where the document needs it.
6. Pass the minimum required content, extraction instructions and approved schema to the AI adapter.
7. Parse the model output as JSON and validate it against the schema.
8. Run deterministic checks such as date format, numeric types, line totals and required fields.
9. Set `completed`, `review_required` or `failed` status; preserve safe diagnostic metadata.
10. Return results through polling or a signed webhook; expire source and export files according to retention rules.

## 6. API Contract — First Version

### 6.1 Minimum endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/v1/templates/analyse` | Analyse sample documents and suggest fields. |
| POST | `/api/v1/templates` | Create a draft template. |
| GET  | `/api/v1/templates` | List authorized templates. |
| GET  | `/api/v1/templates/{template_id}` | Get template details and versions. |
| PATCH | `/api/v1/templates/{template_id}` | Update a draft template. |
| POST | `/api/v1/templates/{template_id}/test` | Test a draft against sample documents. |
| POST | `/api/v1/templates/{template_id}/publish` | Publish immutable version. |
| POST | `/api/v1/extractions` | Submit a document. |
| GET  | `/api/v1/extractions/{job_id}` | Poll status and fetch result. |
| GET  | `/api/v1/extractions/{job_id}/export` | Download JSON/CSV/XLSX output. |
| POST | `/api/v1/api-keys` | Create a scoped API key; admin only. |
| DELETE | `/api/v1/api-keys/{key_id}` | Revoke a key; admin only. |

### 6.2 Example request
```http
POST /api/v1/extractions
Authorization: Bearer <API_KEY>
Idempotency-Key: <unique-id>
Content-Type: multipart/form-data

file: invoice.pdf
template_id: tpl_invoice
template_version: 1.0
output_format: json
```

### 6.3 Expected asynchronous response
```json
HTTP 202 Accepted
{
  "job_id": "job_12345",
  "status": "queued",
  "status_url": "/api/v1/extractions/job_12345",
  "request_id": "req_67890"
}
```

### 6.4 Example result shape
```json
{
  "job_id": "job_12345",
  "status": "completed",
  "template": {"id": "tpl_invoice", "version": "1.0"},
  "data": {
    "invoice_number": "INV-001",
    "invoice_date": "2026-10-25",
    "vendor_name": "Example Supplier",
    "total_amount": 125000.00,
    "line_items": [
      {"description": "Service", "quantity": 1, "unit_price": 125000.00, "line_total": 125000.00}
    ]
  },
  "validation": {"is_valid": true, "missing_fields": [], "issues": []}
}
```

> Sample values are illustrative only. The deployed API URL, file limits,
> authentication, error codes and response schema must be finalized in
> implementation.

### 6.5 API error model
```json
{
  "error": {
    "code": "FILE_TYPE_NOT_SUPPORTED",
    "message": "The uploaded file type is not supported.",
    "request_id": "req_67890"
  }
}
```

### API implementation rules
- Use HTTPS and stable versioned paths.
- Store API key hashes, not plaintext secrets; show the full key only once.
- Never place production API keys in browser code or mobile binaries. Customer apps should call from a trusted backend.
- Use idempotency keys and bounded retries to avoid duplicate jobs.
- Return standard errors for 400, 401, 403, 404, 409, 413, 415, 422, 429 and 5xx cases.
- Use webhook signatures and event IDs if webhooks are added.
- Pin customer integrations to a published template version.

## 7. Database Baseline

| Table | Minimum fields / constraints |
|---|---|
| organizations | id, name, status, created_at |
| users | id, identity_subject, email, status, created_at |
| organization_members | organization_id, user_id, role; unique organization/user pair |
| templates | id, organization_id, name, document_type, status, created_by |
| template_versions | id, template_id, version, schema_json, instructions, published_at; immutable after publish |
| api_keys | id, organization_id, key_prefix, secret_hash, scopes, status, expires_at, last_used_at |
| documents | id, organization_id, storage_key, mime_type, size_bytes, checksum, retention_until |
| extraction_jobs | id, organization_id, document_id, template_version_id, status, attempt_count, timestamps |
| extraction_results | job_id, structured_json, validation_json, review_status, provider metadata |
| exports | id, job_id, format, storage_key, expires_at |
| usage_records | organization_id, job_id, page_count, processing_ms, model usage and estimated cost |
| audit_logs | organization_id, actor_id, action, resource_type, resource_id, request_id, timestamp |

> Use migrations from day one. Add indexes for organization_id, job status,
> created_at and template lookups. Keep file bytes in object storage, not the
> relational database. Use database constraints and application authorization
> together.

## 8. Security and Privacy Checklist
- Enforce organization-level authorization on every template, job, document, export and API-key request.
- Validate file signature as well as declared MIME type; set size and page limits; isolate risky parsers.
- Keep buckets private and use short-lived signed download URLs.
- Use TLS, managed encryption, least-privilege service accounts and a secret manager.
- Redact sensitive values from logs; never log full document text, credentials or raw API keys.
- Treat document content as untrusted input; it must not override extraction instructions or trigger tools.
- Define retention and deletion behavior for originals, extracted JSON, logs, exports and backups.
- Use quotas and rate limits to prevent accidental cost spikes or abuse.
- Run dependency scans and security tests; maintain a process to rotate/revoke compromised keys.
- Do not use customer documents to train shared models unless an explicit, reviewed opt-in policy permits it.
- Document AI provider data handling, processing region and contractual terms before sending real customer data.

## 9. Solo Developer Execution Roadmap

> This plan is intentionally organized for one developer. Work in vertical
> slices and keep each milestone deployable. The timeline is indicative and
> assumes part-time product discovery alongside implementation.

| Milestone | Indicative duration | Build tasks | Definition of done |
|---|---|---|---|
| M0 — Discovery and evaluation set | 3–5 days | Collect permitted sample docs; define invoice fields; label expected values; compare parsers/OCR/models; set limits and cost metrics. | Baseline dataset and go/no-go decision exist. |
| M1 — Repository and skeleton | 2–4 days | Repo, config, linting, tests, FastAPI health endpoint, frontend shell, local database and migrations. | Local app starts with documented setup and automated checks. |
| M2 — Upload and raw parsing | 4–6 days | Upload UI/API, file validation, PDF text parsing, storage abstraction and job record. | Text PDF can be uploaded and parsed safely. |
| M3 — OCR and job lifecycle | 4–6 days | OCR adapter, queue/worker, statuses, polling, retries and failure states. | Scanned image/PDF processes asynchronously. |
| M4 — Invoice extraction | 4–7 days | Schema, AI adapter, prompt/instructions, structured output, Pydantic/JSON Schema validation and result UI. | Golden test set evaluated; errors and missing fields are visible. |
| M5 — Template builder | 5–8 days | Sample analysis, field suggestion, schema editor, draft/test/publish and versioning. | User can configure and test a template without code edits. |
| M6 — Public API integration | 4–6 days | API key lifecycle, extraction endpoint, polling, quotas, docs and cURL example. | Separate test client integrates using a scoped key. |
| M7 — Exports and history | 3–5 days | JSON/CSV/XLSX export, job history, search/filter and download expiry. | Export output matches schema and table rules. |
| M8 — Cloud deployment and hardening | 5–8 days | Cloud Run, private storage, managed DB, queue, secrets, IAM, logging, alerts, security and recovery tests. | Staging environment passes go-live checklist. |
| M9 — Pilot and fixes | 5–10 days | Use varied documents, inspect field-level quality, fix failure patterns, test concurrency and document runbooks. | Pilot acceptance gates met or remaining gaps are explicitly recorded. |

> **Indicative solo calendar range**: approximately 8–12 focused weeks,
> depending on available hours, experience, provider integration and document
> complexity. Add contingency; do not treat this as a delivery commitment.

### 9.1 Daily working loop
1. Choose one small outcome from the backlog.
2. Write or update acceptance criteria before implementation.
3. Implement the smallest end-to-end slice.
4. Add tests and run the labelled evaluation set where extraction logic changes.
5. Review security, logging and failure handling.
6. Commit changes with a clear message and update the decision log.
7. Deploy to development/staging only after checks pass.

## 10. Prioritized Backlog

| ID | Epic | Task | Priority | Dependency |
|---|---|---|---|---|
| B-001 | Foundation | Create repository, environment config, linting and CI checks | P0 | None |
| B-002 | Foundation | Define Pydantic models and API error contract | P0 | B-001 |
| B-003 | Identity | Implement sign-in and organization context | P0 | B-001 |
| B-004 | Data | Add migrations for organizations, templates, jobs and results | P0 | B-001 |
| B-005 | Upload | Implement file type/size/page validation and safe storage | P0 | B-002, B-004 |
| B-006 | Parsing | Implement native PDF text extraction and empty-text detection | P0 | B-005 |
| B-007 | OCR | Add OCR adapter and scanned-file routing | P0 | B-006 |
| B-008 | Jobs | Add queue/worker, job states, retries and polling | P0 | B-004, B-007 |
| B-009 | Extraction | Create invoice schema and structured extraction adapter | P0 | B-006/007 |
| B-010 | Validation | Validate output types, required fields and business checks | P0 | B-009 |
| B-011 | UI | Show job status, structured result and validation issues | P0 | B-008, B-010 |
| B-012 | Templates | Implement draft template CRUD and schema storage | P0 | B-004 |
| B-013 | Templates | Analyse samples and suggest fields | P1 | B-009, B-012 |
| B-014 | Templates | Test template and publish immutable version | P0 | B-012, B-010 |
| B-015 | API | Generate/revoke scoped API keys and store hashes | P0 | B-003, B-004 |
| B-016 | API | Expose external extraction endpoint and polling contract | P0 | B-008, B-014, B-015 |
| B-017 | Exports | Export JSON and CSV | P1 | B-010 |
| B-018 | Exports | Export XLSX with summary and line-items sheets | P1 | B-017 |
| B-019 | Operations | Add rate limits, usage metrics, audit events and retention cleanup | P0 | B-004, B-015 |
| B-020 | Cloud | Deploy staging with IAM, secrets, storage and monitoring | P0 | B-001 through core MVP |
| B-021 | QA | Build golden-set regression tests and security negative tests | P0 | B-006 through B-016 |
| B-022 | Pilot | Run acceptance evaluation and resolve critical issues | P0 | B-020, B-021 |

## 11. Testing and Extraction Evaluation

### 11.1 Golden dataset
- Create a small, permissioned set of representative documents with varied suppliers, layouts, scan quality and page counts.
- For each document, manually label expected header fields and line items.
- Record ground truth for missing fields, ambiguous values and intentionally invalid documents.
- Keep a separate holdout set that is not used to tune prompts or rules.
- Measure exact-match accuracy for identifiers, normalized match for dates/currency, numeric tolerance for amounts and row-level metrics for line items.

### 11.2 Required test categories

| Category | Examples |
|---|---|
| Functional | Upload, extract, edit schema, publish, call API, poll, export and revoke key. |
| Quality | Different invoice layouts, missing fields, low-resolution scans, rotated pages and multi-page tables. |
| Security | Cross-tenant access, revoked keys, oversized files, malicious files, prompt injection and secret leakage. |
| Reliability | Provider timeout, worker crash, duplicate queue delivery, retry exhaustion and webhook failure. |
| Performance | Concurrent jobs, large page counts, queue backlog, API latency and database load. |
| Data handling | Retention expiration, deletion request, export URL expiry, backup and restore. |

### 11.3 Release gates
- No unresolved critical security defects.
- All core acceptance tests pass.
- Schema validation and missing-value behavior are deterministic.
- Field-level extraction metrics meet the agreed threshold on the holdout set.
- Cost per page/document has been measured and is within the chosen budget.
- Monitoring, alerting, backup, retention and incident runbooks are in place.
- API documentation and example integration have been tested from a separate client.

## 12. Operational Checklist

| Area | Checklist |
|---|---|
| Deployments | Separate dev/staging/prod config; controlled migrations; rollback plan; health checks. |
| Secrets | Secret manager configured; key rotation documented; no secrets in repo or logs. |
| Monitoring | API errors/latency, queue age, worker failures, provider failures, cost and storage growth monitored. |
| Data lifecycle | Retention defaults, deletion job, expired export cleanup and documented backup behavior. |
| Support | Runbook for stuck jobs, provider outage, compromised key, queue backlog and failed deployment. |
| Cost control | File/page caps, rate limits, tenant quotas, model usage tracking and alerts. |
| Customer integration | Sample cURL/Python/JavaScript snippets, error code reference, polling and webhook guidance. |

## 13. Key Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Extraction quality varies by layout | Test with a representative golden set; use template instructions, OCR/layout routing and review flags. |
| AI returns unsupported values | Use null for absent values, source grounding, strict schema validation and deterministic business checks. |
| Unexpected provider costs | Measure cost per job/page, limit pages, route easy PDFs to parsers and set quotas. |
| Too much scope for one developer | Keep invoice extraction as the first end-to-end slice; defer billing, broad file types and advanced analytics. |
| Security mistakes in a multi-tenant system | Build tenant checks early, add negative authorization tests and use private storage. |
| API breaking changes | Publish immutable schema versions and test compatibility before releases. |
| Provider outages or rate limits | Bounded retries, backoff, job status, dead-letter handling and documented provider fallback policy. |
| Sensitive document exposure | Minimize retention, restrict access, avoid content logs and confirm provider data terms. |

## 14. Decision Log — Fill This In During Discovery

| Decision | Default proposal | Status / notes |
|---|---|---|
| Initial template | Invoice | Open |
| Input formats | PDF, PNG, JPG/JPEG | Open |
| Maximum upload size/pages | Set after POC and hosting tests | Open |
| OCR engine | Benchmark PaddleOCR vs Tesseract | Open |
| Document layout parser | Add Docling only if evaluation proves value | Open |
| AI provider/model | Select after accuracy, privacy, latency and cost comparison | Open |
| Hosting | Google Cloud Run + Cloud Storage + managed PostgreSQL | Open |
| Queue | Choose Cloud Tasks or Pub/Sub based on retry/fan-out needs | Open |
| Default retention | Minimum necessary; exact duration to be decided | Open |
| Synchronous threshold | Async by default for long-running documents | Open |
| API key model | Organization-scoped key + template ID/version | Open |
| Commercial billing | Defer until after the product is validated | Open |

## 15. Definition of a Successful MVP

The MVP is successful when you can independently demonstrate the following end-to-end scenario:

1. Sign in and upload a representative invoice.
2. Extract native PDF text or run OCR for a scan.
3. Create a template from sample documents and review suggested fields.
4. Edit and publish a versioned schema.
5. Run extraction and receive schema-valid JSON with missing fields and validation issues clearly represented.
6. Call the same published template from a separate backend using an API key.
7. Poll the job status and retrieve the result without accessing another organization's data.
8. Export results to JSON/CSV and XLSX where appropriate.
9. Observe logs/metrics, revoke a key, and verify retention/deletion behavior.
10. Run the golden test set and record quality, latency and cost.

## Appendix A — Suggested repository layout
```
document-extraction-platform/
  apps/
    web/        # React / Next.js
    api/        # FastAPI routes, auth and control plane
    worker/     # asynchronous processing
  packages/
    schemas/    # Pydantic models and JSON Schema
    extraction/ # PDF, OCR, layout and AI adapters
    validation/ # schema and business checks
  migrations/
  tests/
    unit/
    integration/
    contract/
    evaluation/  # golden-set tests
  infrastructure/
    environments/
    deployment/
    monitoring/
  docs/
    architecture/
    api/
    runbooks/
  README.md
```

## Appendix B — Reference documentation
- FastAPI: https://fastapi.tiangolo.com/
- PyMuPDF: https://pymupdf.readthedocs.io/
- PaddleOCR: https://github.com/PaddlePaddle/PaddleOCR
- Tesseract OCR: https://github.com/tesseract-ocr/tesseract
- Docling: https://github.com/docling-project/docling
- Google Cloud Run: https://cloud.google.com/run/docs
- Google Cloud Storage: https://cloud.google.com/storage/docs
- Google Secret Manager: https://cloud.google.com/secret-manager/docs
- PostgreSQL documentation: https://www.postgresql.org/docs/

---

> Final note: Treat this document as your working engineering plan. Start
> with M0 and build one complete path from upload to validated JSON before
> expanding the scope. Use measured results to make decisions about OCR/model
> selection, performance targets, cloud sizing and release readiness.

*Personal Engineering Working Document · Version 1.0 · 25 October 2026*
