/**
 * /api/jobs/[id]/export?format=json|csv
 *   GET — download result as JSON or CSV
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { deserializeTemplateFields } from '@/lib/templates/schema'
import { exportJson, exportCsv, downloadFilename, type ExportFormat } from '@/lib/export/export'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const url = new URL(req.url)
  const format = (url.searchParams.get('format') ?? 'json') as ExportFormat

  const j = await db.job.findUnique({
    where: { id },
    include: { template: true },
  })
  if (!j) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Job not found' } }, { status: 404 })
  }
  if (!j.extractedJson) {
    return NextResponse.json({ error: { code: 'NO_DATA', message: 'Job has no extracted data' } }, { status: 409 })
  }

  const data = JSON.parse(j.extractedJson) as Record<string, unknown>
  const template = {
    id: j.template.id,
    name: j.template.name,
    documentType: j.template.documentType,
    fields: deserializeTemplateFields(j.template.fieldsJson),
    instructions: j.template.instructions ?? undefined,
  }

  const filename = downloadFilename(j.fileName.replace(/\.[^.]+$/, ''), format)
  let body: string
  let contentType: string

  if (format === 'csv') {
    body = exportCsv(data, template)
    contentType = 'text/csv'
  } else {
    body = exportJson(data)
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
