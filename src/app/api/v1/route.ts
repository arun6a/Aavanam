/**
 * Public API v1 — GET returns API metadata + available endpoints.
 *
 * All /api/v1/* routes require an API key via `Authorization: Bearer <key>`.
 * The internal auth middleware (lib/auth-context.ts) handles this — these
 * routes just call `getAuthContext(req)` and the auth resolves to the
 * org + scopes associated with the API key.
 *
 * Per BRD §6.1 — versioned paths, HTTPS only, scope-aware authorization.
 */

import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    name: 'Aavanam Public API',
    version: '1.0',
    description: 'AI Document Extraction Platform',
    auth: 'Bearer token (API key)',
    endpoints: [
      { method: 'POST',   path: '/api/v1/extractions',                          description: 'Submit a document for extraction' },
      { method: 'GET',    path: '/api/v1/extractions/{job_id}',                 description: 'Poll job status + retrieve result' },
      { method: 'GET',    path: '/api/v1/extractions/{job_id}/export?format=json|csv|xlsx', description: 'Download result' },
      { method: 'GET',    path: '/api/v1/templates',                            description: 'List templates' },
      { method: 'GET',    path: '/api/v1/templates/{id}',                       description: 'Get template details' },
      { method: 'GET',    path: '/api/v1/api-keys',                            description: 'List API keys (admin scope only)' },
    ],
    example: {
      submit: 'curl -X POST https://your-app.com/api/v1/extractions -H "Authorization: Bearer aava_xxx" -F file=@invoice.pdf -F templateId=tpl_xxx',
      poll: 'curl https://your-app.com/api/v1/extractions/job_xxx -H "Authorization: Bearer aava_xxx"',
    },
  })
}
