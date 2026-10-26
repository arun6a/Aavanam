/**
 * GET /api/v1/extractions/{job_id}/export?format=json|csv|xlsx
 *   Authorization: Bearer <api_key>
 *
 * Download the result in the requested format.
 * Reuses the same export logic as /api/jobs/[id]/export — they share lib/export.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/auth-context'
import { deserializeTemplateFields, type TemplateDef } from '@/lib/templates/schema'
import { exportJson, exportCsv, exportXlsx, downloadFilename, type ExportFormat } from '@/lib/export/export'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext(req)
  if (!ctx) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header.' } }, { status: 401 })
  }
  const { id } = await params
  const url = new URL(req.url)
  const format = (url.searchParams.get('format') ?? 'json') as ExportFormat

  const j = await db.job.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: { template: true },
  })
  if (!j) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Job not found' } }, { status: 404 })
  }
  if (!j.extractedJson) {
    return NextResponse.json({ error: { code: 'NO_DATA', message: 'Job has no extracted data' } }, { status: 409 })
  }

  const data = JSON.parse(j.extractedJson) as Record<string, unknown>
  const template: TemplateDef = {
    id: j.template.id,
    name: j.template.name,
    documentType: j.template.documentType,
    fields: deserializeTemplateFields(j.template.fieldsJson),
    instructions: j.template.instructions ?? undefined,
  }

  const filename = downloadFilename(j.fileName.replace(/\.[^.]+$/, ''), format)
  let body: Buffer
  let contentType: string

  if (format === 'csv') {
    body = Buffer.from(exportCsv(data, template), 'utf-8')
    contentType = 'text/csv'
  } else if (format === 'xlsx') {
    body = exportXlsx(data, template)
    contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  } else {
    body = Buffer.from(exportJson(data), 'utf-8')
    contentType = 'application/json'
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
