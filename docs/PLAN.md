# Aavanam — Phased Implementation Plan

**Built**: Day 1+2 (MVP vertical slice — see `CURRENT-STAGE.md` for what shipped)
**Target**: Full multi-tenant SaaS per the architecture diagram (see `docs/BRD.md` §5)

This document maps the remaining work from current state to the target
architecture in 6 phases. Each phase is a meaningful, deployable increment
that delivers user value on its own.

---

## Phase 0 — Rebrand to "Aavanam" (1 day, low risk, high visible impact)

**Why first**: Zero architectural risk. The sponsor's architecture diagram
shows the product name is "Aavanam". Rebrand now so all subsequent UI work
uses the right name from the start.

**Tasks**:
- Update `src/app/page.tsx` header: "AI Document Extraction Platform" → "Aavanam"
- Update `src/app/layout.tsx` metadata title/description
- Update `package.json` name field
- Add a simple logo (Lucide `Sparkles` icon is fine for v1, or sponsor provides one)
- Update README to say Aavanam
- Tagline: "Extract structured data from any document"

**Acceptance**: Page title, browser tab title, package name, and README all say Aavanam.

---

## Phase 1 — Identity & Multi-tenant Foundation (3–4 days)

**Why**: Everything else (public API, audit logs, multi-tenant isolation) depends on having users + orgs. Build the foundation now.

**Tasks**:
- Use the already-installed NextAuth.js v4 to add email/password login
- Add Prisma models: `Organization`, `User`, `OrganizationMember`, `ApiKey`
- All existing tables (`Template`, `Job`) get an `organizationId` foreign key
- Update all DB queries to scope by current user's organization
- Role-based access on UI: Admin (everything) vs Company User (extract only)
- Add a Settings tab showing: profile, organization, current API key (placeholder for Phase 3)
- Sign-up flow: new users create an org → become its admin → invite others later

**Acceptance** (matches BRD §3 US-06):
1. New user can register, gets their own org, all data is isolated
2. Two different orgs cannot see each other's templates or jobs
3. Existing data: seed a default org and assign all existing rows to it (no data loss)

**Files added/changed**:
- `prisma/schema.prisma` — add Organization, User, OrganizationMember, ApiKey models
- `src/lib/auth.ts` — NextAuth config
- `src/app/api/auth/[...nextauth]/route.ts` — NextAuth handler
- `src/components/auth/*` — login + signup forms
- All `src/app/api/*` routes — add `getCurrentOrgId()` check, filter queries by org

---

## Phase 2 — Async Job Queue (3–4 days)

**Why**: The BRD calls for async processing for long-running jobs. Z.ai's GLM-4 takes 30+ seconds on large invoices; OpenAI gpt-4o-mini takes 5-10s. Either way, the sync API we have now can timeout. Move to async.

**Tasks**:
- Pick a queue implementation:
  - **Easy MVP**: in-memory queue with worker thread (no infra needed for dev)
  - **Production**: Cloud Tasks when deployed to GCP
- Add job states: `queued` → `processing` → `completed` | `failed` | `review_required`
- Worker picks up jobs, runs the existing extraction pipeline, updates DB
- API returns `202 Accepted` immediately with `job_id` + `status_url`
- Frontend polls `/api/jobs/{id}` every 2s while status is `queued`/`processing`
- Add a "live job status" indicator in the UI (animated spinner with stage label)
- Add retry on transient failure (LLM timeout, OCR crash) with exponential backoff (max 3 attempts)

**Acceptance** (matches BRD §5.2 step 10):
1. Upload a 50-page PDF → API returns job_id immediately (under 200ms)
2. Frontend shows "Processing… stage: OCR" then "stage: LLM extraction" then "Completed"
3. If the worker crashes mid-job, the job is marked `failed` with safe error message
4. Same job can be polled by job_id without exposing other orgs' jobs

**Files added/changed**:
- `src/lib/queue/index.ts` — queue abstraction (in-memory now, swap to Cloud Tasks later)
- `src/lib/queue/worker.ts` — worker that processes queued jobs
- `src/app/api/extract/route.ts` — return 202 + job_id, push to queue
- `src/components/extraction/upload-panel.tsx` — show job progress
- `prisma/schema.prisma` — Job model already has status/stage fields

---

## Phase 3 — Public API + API Keys (2–3 days, after Phase 1)

**Why**: This is the BRD's M6 — the whole point of the platform. External apps (ERP, accounting, mobile, BPM) call the API to extract documents.

**Tasks**:
- Add `/api/v1/*` namespace (separate from internal `/api/*`)
- Add `ApiKey` Prisma model with: `key_prefix`, `secret_hash`, `scopes`, `status`, `expires_at`, `last_used_at`
- API key generation: show full key ONCE, store only hash
- Authentication middleware: validate `Authorization: Bearer <key>` on all `/api/v1/*` routes
- Public API endpoints (per BRD §6.1):
  - `POST /api/v1/extractions` — submit document, returns `202 + job_id`
  - `GET  /api/v1/extractions/{job_id}` — poll status
  - `GET  /api/v1/extractions/{job_id}/export?format=json|csv` — download
  - `GET  /api/v1/templates` — list org's templates
  - `POST /api/v1/templates` — create new
- API Keys UI: Settings tab → "API Keys" section → list, generate, revoke
- API documentation page: `/docs/api` (just a static page with curl examples, error codes, response schemas)
- Rate limiting: per-API-key, 60 requests/minute, configurable per org

**Acceptance** (matches BRD §3 US-05 + US-06):
1. Generate an API key in the UI, see it once, copy it
2. From a separate terminal: `curl -H "Authorization: Bearer <key>" -F file=@invoice.pdf https://.../api/v1/extractions` → returns `202 + job_id`
3. Poll `GET /api/v1/extractions/{job_id}` → eventually returns `completed` + extracted JSON
4. Revoke the key in UI → next call with that key returns `401 Unauthorized`

**Files added/changed**:
- `src/app/api/v1/*` — new public API routes
- `src/lib/auth/api-key.ts` — API key validation middleware
- `src/components/settings/api-keys-panel.tsx` — API key management UI
- `src/app/docs/api/page.tsx` — API documentation page

---

## Phase 4 — Dashboard + Audit Logs (2–3 days)

**Why**: BRD M6+M9 — operators need visibility into usage, costs, and what happened when. Audit logs are required for any serious business use.

**Tasks**:
- New Dashboard tab with:
  - Usage stats: jobs/day (line chart, last 30 days), success rate, avg processing time
  - By-template breakdown: pie chart of jobs per template
  - Cost tracking: LLM tokens used, OCR calls, estimated cost (configurable per-org rates)
  - Recent activity feed: last 20 jobs with status + link to detail
- Audit log Prisma model: `AuditLog(organizationId, actorId, action, resourceType, resourceId, requestId, timestamp, metadataJson)`
- Hook audit log writes into every state-changing API route:
  - Template created/edited/deleted
  - API key generated/revoked
  - Job submitted/completed/deleted
- Audit log viewer in Settings tab (admin only): filter by action, actor, date range

**Acceptance**:
1. After running 10 jobs, dashboard shows the jobs in last-30-days chart
2. After creating + deleting a template, the audit log shows both actions with timestamps
3. Audit log cannot be modified or deleted (immutable)

**Files added/changed**:
- `src/app/dashboard/page.tsx` — Dashboard tab
- `src/components/dashboard/*` — chart components (use Recharts, already installed)
- `prisma/schema.prisma` — AuditLog model
- `src/lib/audit.ts` — `logAuditEvent(action, resourceType, resourceId)` helper
- All API routes — add `logAuditEvent()` calls
- `src/components/settings/audit-log-viewer.tsx`

---

## Phase 5 — XLSX Export + Confidence Scoring (2–3 days)

**Why**: BRD M7 calls for XLSX; the architecture diagram calls for confidence scoring. Both are high-value, low-risk additions.

**Tasks**:
- Add `xlsx` npm package (or use `exceljs` for more features)
- New `src/lib/export/xlsx.ts` with two sheets:
  - "Document Summary" — header fields, one row per document
  - "Line Items" — one row per line item with doc-level fields repeated (like CSV)
- Add `?format=xlsx` support to `/api/jobs/[id]/export`
- Add XLSX button next to existing JSON/CSV buttons in job history + result view
- LLM confidence: extend `ZaiLlmAdapter.extract()` to also return per-field confidence by asking the LLM to include a `confidence` score (0..1) for each extracted field
- Frontend: render confidence as a colored dot next to each field (green ≥0.9, amber ≥0.7, red <0.7)
- Validation: if any required field has confidence <0.7, mark job as `review_required` (status already supports this)

**Acceptance** (matches BRD §11.1 quality measurement):
1. Download XLSX → opens in Excel/Google Sheets with two tabs
2. Each extracted field has a confidence score visible in the UI
3. Low-confidence required fields trigger `review_required` status automatically

**Files added/changed**:
- `src/lib/export/xlsx.ts` — XLSX generator
- `src/app/api/jobs/[id]/export/route.ts` — add `xlsx` format
- `src/components/extraction/result-panel.tsx` — confidence dots + XLSX button
- `src/lib/extraction/extractor.ts` — ask LLM for per-field confidence

---

## Phase 6 — Cloud Deployment to Google Cloud Run (5–8 days)

**Why**: BRD M8 — production-ready deployment. The Z.ai preview is for development only.

**Tasks**:
- Dockerize the Next.js app (`Dockerfile` + `.dockerignore`)
- Set up Google Cloud SQL PostgreSQL instance (managed)
- Update `prisma/schema.prisma` to PostgreSQL (just change the `provider` — schema is identical)
- Migrate file storage from local /tmp to Google Cloud Storage:
  - Add `src/lib/storage/gcs.ts` — implements the existing storage abstraction
  - Originals: `gs://aavanam-originals/{org_id}/{job_id}.pdf`
  - Exports: `gs://aavanam-exports/{job_id}.{json,csv,xlsx}` with signed URLs (15 min expiry)
- Set up Google Secret Manager for:
  - `OPENAI_API_KEY` (when sponsor switches from Z.ai to OpenAI)
  - `NEXTAUTH_SECRET`
  - `DATABASE_URL`
  - `GCS_BUCKET_ORIGINALS`, `GCS_BUCKET_EXPORTS`
- Cloud Run service: API + worker in same container (or split into two services for independent scaling)
- Move queue from in-memory to Cloud Tasks (or keep in-memory if cost is a concern — Cloud Tasks has a small per-call cost)
- Add Cloud Logging sink — all `console.log`/`console.error` go to Cloud Logging automatically
- Add basic alerting: error rate > 5% for 5 minutes → email sponsor
- Set up CI/CD via GitHub Actions:
  - On push to `main`: lint → test → build → deploy to staging Cloud Run service
  - On tagged release: deploy to prod Cloud Run service
- Document the production deployment process in `docs/deployment.md`

**Acceptance** (matches BRD §15 item 9):
1. Push to `main` → CI passes → staging URL has the new version
2. Production URL: extract a real invoice end-to-end, no errors
3. Logs visible in Cloud Logging
4. Database backups configured (Cloud SQL automated backups)
5. Originals + exports stored in private GCS buckets, not accessible publicly

**Files added/changed**:
- `Dockerfile`, `.dockerignore`
- `prisma/schema.prisma` — change provider to `postgresql`
- `src/lib/storage/gcs.ts` — GCS storage adapter
- `.github/workflows/ci.yml` — CI/CD pipeline
- `docs/deployment.md` — production deployment guide

---

## Summary — Total time to target architecture

| Phase | Days | Cumulative |
|---|---|---|
| Phase 0 — Rebrand to Aavanam | 1 | 1 |
| Phase 1 — Identity & Multi-tenant | 3–4 | 4–5 |
| Phase 2 — Async Job Queue | 3–4 | 7–9 |
| Phase 3 — Public API + API Keys | 2–3 | 9–12 |
| Phase 4 — Dashboard + Audit Logs | 2–3 | 11–15 |
| Phase 5 — XLSX + Confidence Scoring | 2–3 | 13–18 |
| Phase 6 — Cloud Deployment | 5–8 | 18–26 |

**Total**: ~18–26 focused working days (4–6 weeks at sustainable pace) to reach the architecture diagram's target.

This matches the BRD's own estimate of "8–12 focused weeks" plus the
"4–6 weeks for cloud/deployment phase" — the BRD was estimating from
scratch; we already have 25-30% of the work done (M1–M5).

## What to do today

Recommended starting point: **Phase 0** (rebrand to Aavanam) — 1 day, visible
value, no architectural risk. Friend sees "Aavanam" come to life immediately.

Then **Phase 1** (auth + multi-tenant) sets the foundation for everything else
(public API, audit logs, isolation). Without Phase 1, Phase 3 (public API)
doesn't make sense — there's no concept of "another org" yet.

Phase 2 (async queue) is necessary before Phase 3 too — public API callers
need async submit + poll, not 60s sync calls.

Phases 4, 5, 6 can be done in any order after Phases 1-3, but Phase 6
(cloud deployment) is best left for last so all features are stable before
production deploy.
