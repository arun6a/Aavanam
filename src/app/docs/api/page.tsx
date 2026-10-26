/**
 * /docs/api — API documentation page (static, server component).
 *
 * Per BRD §6 implementation rules — "API documentation and example integration
 * have been tested from a separate client."
 *
 * This is a single-page summary with curl examples + error codes + response
 * schemas. A separate /docs page would be more comprehensive; for MVP we
 * serve this directly via the route.
 */

import { Sparkles } from 'lucide-react'
import Link from 'next/link'

export default function ApiDocsPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="rounded-lg bg-primary p-2">
            <Sparkles className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">Aavanam — API Documentation</h1>
            <p className="text-xs text-muted-foreground">Version 1.0 — Public API for external integrations</p>
          </div>
          <Link href="/" className="ml-auto text-sm text-primary hover:underline">← Back to app</Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 prose prose-sm dark:prose-invert max-w-none">
        <h2>Authentication</h2>
        <p>All endpoints under <code>/api/v1/*</code> require a Bearer token in the <code>Authorization</code> header.</p>
        <pre className="bg-muted p-4 rounded-md text-sm overflow-x-auto"><code>{`Authorization: Bearer aava_<your_key>`}</code></pre>
        <p>Generate an API key from the Settings tab in the app (or via the API itself).</p>

        <h2>Endpoints</h2>

        <h3>1. Submit a document for extraction</h3>
        <p><code>POST /api/v1/extractions</code></p>
        <p>Submit a PDF/PNG/JPG/TIFF/DOCX/XLSX document for extraction. Returns <strong>202 Accepted</strong> with a <code>job_id</code> immediately. Processing runs async — poll the next endpoint for status.</p>
        <pre className="bg-muted p-4 rounded-md text-sm overflow-x-auto"><code>{`curl -X POST https://your-app.com/api/v1/extractions \\
  -H "Authorization: Bearer aava_xxx" \\
  -F "file=@invoice.pdf" \\
  -F "templateId=tpl_xxx" \\
  -F "multiInvoice=auto"`}</code></pre>
        <p><strong>Response (202):</strong></p>
        <pre className="bg-muted p-4 rounded-md text-sm overflow-x-auto"><code>{`{
  "job_id": "cmv...",
  "status": "queued",
  "status_url": "/api/v1/extractions/cmv...",
  "request_id": "cmv..."
}`}</code></pre>

        <h3>2. Poll job status + retrieve result</h3>
        <p><code>GET /api/v1/extractions/{'{job_id}'}</code></p>
        <p>Poll the status_url from the submit response. Returns the full job state including extracted data once complete.</p>
        <pre className="bg-muted p-4 rounded-md text-sm overflow-x-auto"><code>{`curl https://your-app.com/api/v1/extractions/cmv... \\
  -H "Authorization: Bearer aava_xxx"`}</code></pre>
        <p><strong>Response (200) when complete:</strong></p>
        <pre className="bg-muted p-4 rounded-md text-sm overflow-x-auto"><code>{`{
  "job_id": "cmv...",
  "status": "completed",  // queued | processing | completed | review_required | failed
  "template": {
    "id": "tpl_xxx",
    "name": "Invoice (basic)",
    "version": "1.0"
  },
  "data": {
    "invoice_number": "INV-001",
    "invoice_date": "2026-10-25",
    "vendor_name": "Acme Corp",
    "total_amount": 1350.00,
    "line_items": [...],
    "_confidence": {
      "invoice_number": 1.0,
      ...
    }
  },
  "validation": {
    "is_valid": true,
    "missing_fields": [],
    "issues": []
  },
  "diagnostics": {
    "ocr_engine": "tesseract",
    "ocr_confidence": 0.87,
    "llm_model": "zai-glm-4",
    "total_processing_ms": 4700
  }
}`}</code></pre>

        <h3>3. Download result as JSON / CSV / XLSX</h3>
        <p><code>GET /api/v1/extractions/{'{job_id}'}/export?format=json|csv|xlsx</code></p>
        <pre className="bg-muted p-4 rounded-md text-sm overflow-x-auto"><code>{`# JSON
curl https://your-app.com/api/v1/extractions/cmv.../export?format=json \\
  -H "Authorization: Bearer aava_xxx" -o result.json

# CSV (one row per line item with doc-level fields repeated)
curl https://your-app.com/api/v1/extractions/cmv.../export?format=csv \\
  -H "Authorization: Bearer aava_xxx" -o result.csv

# XLSX (two sheets: Document Summary + Line Items)
curl https://your-app.com/api/v1/extractions/cmv.../export?format=xlsx \\
  -H "Authorization: Bearer aava_xxx" -o result.xlsx`}</code></pre>

        <h3>4. List templates</h3>
        <p><code>GET /api/v1/templates</code></p>
        <pre className="bg-muted p-4 rounded-md text-sm overflow-x-auto"><code>{`curl https://your-app.com/api/v1/templates \\
  -H "Authorization: Bearer aava_xxx"`}</code></pre>

        <h3>5. Get one template</h3>
        <p><code>GET /api/v1/templates/{'{id}'}</code></p>

        <h3>6. Update a draft template</h3>
        <p><code>PATCH /api/v1/templates/{'{id}'}</code> — refuses if template is already published.</p>

        <h3>7. Analyse sample + suggest fields</h3>
        <p><code>POST /api/v1/templates/analyse</code></p>
        <pre className="bg-muted p-4 rounded-md text-sm overflow-x-auto"><code>{`curl -X POST https://your-app.com/api/v1/templates/analyse \\
  -H "Authorization: Bearer aava_xxx" \\
  -F "file=@sample.pdf"`}</code></pre>
        <p>Returns an array of suggested field definitions the user can edit + use to create a new template.</p>

        <h3>8. Generate API key</h3>
        <p><code>POST /api/v1/api-keys</code></p>
        <pre className="bg-muted p-4 rounded-md text-sm overflow-x-auto"><code>{`curl -X POST https://your-app.com/api/v1/api-keys \\
  -H "Authorization: Bearer aava_existing_key" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Production ERP","scopes":"extract:write,extract:read"}'`}</code></pre>

        <h3>9. Revoke API key</h3>
        <p><code>DELETE /api/v1/api-keys/{'{id}'}</code></p>

        <h2>Error codes</h2>
        <table className="w-full text-sm border-collapse">
          <thead className="bg-muted">
            <tr><th className="border p-2 text-left">HTTP</th><th className="border p-2 text-left">Code</th><th className="border p-2 text-left">Meaning</th></tr>
          </thead>
          <tbody>
            <tr><td className="border p-2">400</td><td className="border p-2 font-mono">NO_FILE / INVALID_CONTENT_TYPE</td><td className="border p-2">Missing file or wrong content type</td></tr>
            <tr><td className="border p-2">401</td><td className="border p-2 font-mono">UNAUTHORIZED</td><td className="border p-2">Missing or invalid Authorization header</td></tr>
            <tr><td className="border p-2">403</td><td className="border p-2 font-mono">FORBIDDEN</td><td className="border p-2">Authenticated but lacks permission</td></tr>
            <tr><td className="border p-2">404</td><td className="border p-2 font-mono">NOT_FOUND</td><td className="border p-2">Job/template/key not found in your organization</td></tr>
            <tr><td className="border p-2">409</td><td className="border p-2 font-mono">TEMPLATE_PUBLISHED / ALREADY_MEMBER</td><td className="border p-2">Conflict — resource in a state that forbids the action</td></tr>
            <tr><td className="border p-2">413</td><td className="border p-2 font-mono">FILE_TOO_LARGE</td><td className="border p-2">File exceeds 10 MB limit</td></tr>
            <tr><td className="border p-2">415</td><td className="border p-2 font-mono">FILE_TYPE_NOT_SUPPORTED</td><td className="border p-2">MIME type not in allowlist</td></tr>
            <tr><td className="border p-2">422</td><td className="border p-2 font-mono">MISSING_FIELDS / INVALID_INPUT</td><td className="border p-2">Required fields missing in request</td></tr>
            <tr><td className="border p-2">429</td><td className="border p-2 font-mono">RATE_LIMITED</td><td className="border p-2">Too many requests (limit: 60/min)</td></tr>
            <tr><td className="border p-2">500</td><td className="border p-2 font-mono">INTERNAL</td><td className="border p-2">Server error — check logs</td></tr>
          </tbody>
        </table>

        <h2>Rate limits</h2>
        <p>60 requests per minute per identity (API key or IP). Returns <code>429</code> with <code>Retry-After: 60</code> header when exceeded.</p>

        <h2>Webhooks</h2>
        <p>Configure webhook URLs from the Settings tab. Aavanam POSTs to each registered URL on job completion.</p>
        <pre className="bg-muted p-4 rounded-md text-sm overflow-x-auto"><code>{`POST https://your-app.com/your-webhook-endpoint
Content-Type: application/json
X-Aavanam-Event: job.completed
X-Aavanam-Signature: sha256=<hmac_sha256_of_body_using_your_secret>

{
  "event": "job.completed",
  "job_id": "cmv...",
  "organization_id": "cmv...",
  "status": "completed",
  "timestamp": "2026-10-26T10:30:00.000Z"
}`}</code></pre>
        <p>Verify the signature on your server by recomputing HMAC-SHA256 of the request body with your webhook secret and comparing to <code>X-Aavanam-Signature</code>.</p>

        <h2>Python example</h2>
        <pre className="bg-muted p-4 rounded-md text-sm overflow-x-auto"><code>{`import requests, time

API_KEY = "aava_xxx"
BASE = "https://your-app.com/api/v1"

# 1. Submit
with open("invoice.pdf", "rb") as f:
    r = requests.post(f"{BASE}/extractions",
        headers={"Authorization": f"Bearer {API_KEY}"},
        files={"file": f},
        data={"templateId": "tpl_xxx"})
job_id = r.json()["job_id"]

# 2. Poll
while True:
    r = requests.get(f"{BASE}/extractions/{job_id}",
        headers={"Authorization": f"Bearer {API_KEY}"})
    data = r.json()
    if data["status"] not in ("queued", "processing"):
        break
    time.sleep(2)

print(data["data"])
print("Validation:", data["validation"])`}</code></pre>

        <h2>Idempotency</h2>
        <p>Send an <code>Idempotency-Key</code> header on POST requests to avoid duplicate jobs. Two requests with the same key within 24 hours return the same <code>job_id</code>.</p>
        <p className="text-muted-foreground text-xs mt-8">Generated from <code>/docs/api/route.tsx</code>. For more see <Link href="/docs/BRD.md" className="text-primary hover:underline">BRD.md</Link> in the GitHub repo.</p>
      </main>
    </div>
  )
}
