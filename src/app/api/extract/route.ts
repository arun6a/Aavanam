/**
 * POST /api/extract
 *   multipart/form-data:
 *     file:        PDF, PNG, JPG, TIFF, DOCX, or XLSX (per architecture diagram)
 *     templateId:  required — must belong to current org
 *     multiInvoice: auto | on | off (default: auto)
 *
 * Returns:
 *   202 Accepted with { job_id, status: 'queued', status_url }
 *   The client polls GET /api/jobs/{job_id} for status + result.
 *
 * Per BRD §5.2 + §6.3 — async API. The actual processing runs in the
 * background via the in-memory queue (lib/queue) + worker (lib/queue/worker).
 *
 * Per BRD §5.1 — every record scoped to current org (session user OR API key).
 */

import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import { fileTypeFromBuffer } from 'file-type'

import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/auth-context'
import { logAudit } from '@/lib/audit'
import { enqueueJob } from '@/lib/queue'

const MAX_FILE_SIZE = 10 * 1024 * 1024  // 10 MB
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
      { error: { code: 'UNAUTHORIZED', message: 'Sign in or pass an API key.' } },
      { status: 401 },
    )
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

    // Verify template belongs to current org
    const template = await db.template.findFirst({
      where: { id: templateId, organizationId: ctx.organizationId },
    })
    if (!template) {
      return NextResponse.json(
        { error: { code: 'TEMPLATE_NOT_FOUND', message: 'Template not found in your organization.' } },
        { status: 404 },
      )
    }

    // Save file to disk
    await fs.mkdir(UPLOAD_DIR, { recursive: true })
    const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const storagePath = path.join(UPLOAD_DIR, safeName)
    await fs.writeFile(storagePath, buffer)

    // Create job record (status=queued)
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

    // Audit log
    await logAudit({
      ctx,
      action: 'job.submit',
      resourceType: 'job',
      resourceId: job.id,
      metadata: { fileName: file.name, fileSize: file.size, templateId: template.id, templateName: template.name },
    })

    // Enqueue for async processing
    enqueueJob(job.id)

    // Return 202 with job_id + status_url (per BRD §6.3)
    return NextResponse.json({
      job_id: job.id,
      status: 'queued',
      status_url: `/api/jobs/${job.id}`,
      request_id: job.id,
    }, { status: 202 })
  } catch (e) {
    console.error('[extract] error:', e)
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json(
      { error: { code: 'INTERNAL', message } },
      { status: 500 },
    )
  }
}

// ─── GET /api/extract ──────────────────────────────────────────────────────
// Returns metadata for the extract endpoint — supported formats, limits.
export async function GET() {
  return NextResponse.json({
    max_file_size_bytes: MAX_FILE_SIZE,
    max_file_size_mb: MAX_FILE_SIZE / 1024 / 1024,
    allowed_mime_types: ALLOWED_MIMES,
    ocr_engines: [
      { id: 'tesseract', name: 'Tesseract 5 (English)', available: true },
      { id: 'paddleocr', name: 'PaddleOCR v5', available: false,
        note: 'Needs Python worker — deploy to a server with Python to enable.' },
    ],
    llm_provider: 'zai',
    llm_model: 'zai-glm-4',
    api_mode: 'async',
    status_poll_endpoint: '/api/jobs/{job_id}',
  })
}
