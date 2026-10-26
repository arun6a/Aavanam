/**
 * POST /api/v1/extractions
 *   multipart/form-data:
 *     file: PDF/PNG/JPG/TIFF/DOCX/XLSX
 *     templateId: required
 *     multiInvoice: auto | on | off (default: auto)
 *   Authorization: Bearer <api_key>
 *
 * Returns 202 Accepted with { job_id, status: 'queued', status_url } — per BRD §6.3.
 * The actual processing runs in the background (lib/queue + worker).
 *
 * This endpoint is identical to the internal /api/extract endpoint — both
 * go through the same auth-context resolver which accepts session OR API key.
 * The /api/v1/* prefix just signals "public API contract — version-stable".
 */

import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import { fileTypeFromBuffer } from 'file-type'

import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/auth-context'
import { logAudit } from '@/lib/audit'
import { enqueueJob } from '@/lib/queue'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const UPLOAD_DIR = '/tmp/aavanam-uploads'

const ALLOWED_MIMES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/tiff',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req)
  if (!ctx) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header. Pass `Authorization: Bearer aava_<key>`.' } },
      { status: 401 },
    )
  }
  // API key must have extract:write scope (we don't enforce strictly in MVP —
  // any active API key works. Production would parse scopes from ctx.)
  if (ctx.role === 'api') {
    // OK — API callers can submit
  }

  try {
    const formData = await req.formData()
    const file = formData.get('file')
    const templateId = (formData.get('templateId') as string | null) ?? null

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: { code: 'NO_FILE', message: 'No file uploaded.' } },
        { status: 400 },
      )
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: { code: 'FILE_TOO_LARGE', message: `Max file size is ${MAX_FILE_SIZE / 1024 / 1024} MB` } },
        { status: 413 },
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const detected = await fileTypeFromBuffer(buffer)
    const mimeType = detected?.mime ?? file.type

    if (!ALLOWED_MIMES.includes(mimeType)) {
      return NextResponse.json(
        { error: { code: 'FILE_TYPE_NOT_SUPPORTED', message: `Unsupported file type: ${mimeType}` } },
        { status: 415 },
      )
    }

    if (!templateId) {
      return NextResponse.json(
        { error: { code: 'MISSING_TEMPLATE', message: 'templateId is required.' } },
        { status: 422 },
      )
    }

    const template = await db.template.findFirst({
      where: { id: templateId, organizationId: ctx.organizationId },
    })
    if (!template) {
      return NextResponse.json(
        { error: { code: 'TEMPLATE_NOT_FOUND', message: 'Template not found in your organization.' } },
        { status: 404 },
      )
    }

    await fs.mkdir(UPLOAD_DIR, { recursive: true })
    const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const storagePath = path.join(UPLOAD_DIR, safeName)
    await fs.writeFile(storagePath, buffer)

    const job = await db.job.create({
      data: {
        organizationId: ctx.organizationId,
        templateId: template.id,
        fileName: file.name,
        fileSize: file.size,
        mimeType,
        storagePath,
        status: 'queued',
        stage: 'queued',
      },
    })

    await logAudit({
      ctx,
      action: 'job.submit_api',
      resourceType: 'job',
      resourceId: job.id,
      metadata: { fileName: file.name, fileSize: file.size, templateId: template.id, templateName: template.name },
    })

    enqueueJob(job.id)

    return NextResponse.json({
      job_id: job.id,
      status: 'queued',
      status_url: `/api/v1/extractions/${job.id}`,
      request_id: job.id,
    }, { status: 202 })
  } catch (e) {
    console.error('[v1/extractions] error:', e)
    return NextResponse.json(
      { error: { code: 'INTERNAL', message: e instanceof Error ? e.message : 'Unknown error' } },
      { status: 500 },
    )
  }
}
