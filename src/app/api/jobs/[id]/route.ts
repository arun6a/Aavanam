/**
 * /api/jobs/[id]
 *   GET    — get one job + full result + validation + raw OCR text
 *   DELETE — delete a job
 *
 * Org-scoped: jobs not belonging to the current org return 404 (not 403, to
 * avoid leaking existence of other orgs' jobs).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/auth-context'
import { logAudit } from '@/lib/audit'
import { deserializeTemplateFields } from '@/lib/templates/schema'

async function getJobForOrg(jobId: string, organizationId: string) {
  return db.job.findFirst({
    where: { id: jobId, organizationId },
    include: { template: true },
  })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext(req)
  if (!ctx) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in or pass an API key.' } }, { status: 401 })
  }
  const { id } = await params
  const j = await getJobForOrg(id, ctx.organizationId)
  if (!j) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Job not found' } }, { status: 404 })
  }

  return NextResponse.json({
    id: j.id,
    template: {
      id: j.template.id,
      name: j.template.name,
      fields: deserializeTemplateFields(j.template.fieldsJson),
      instructions: j.template.instructions,
    },
    file_name: j.fileName,
    file_size: j.fileSize,
    mime_type: j.mimeType,
    status: j.status,
    stage: j.stage,
    error_message: j.errorMessage,
    error_code: j.errorCode,
    multi_invoice: j.multiInvoice,
    document_count: j.documentCount,
    diagnostics: {
      ocr_engine: j.ocrEngine,
      ocr_confidence: j.ocrConfidence,
      ocr_time_ms: j.ocrTimeMs,
      pdf_text_length: j.pdfTextLength,
      pdf_time_ms: j.pdfTimeMs,
      llm_model: j.llmModel,
      llm_time_ms: j.llmTimeMs,
      llm_tokens_in: j.llmTokensIn,
      llm_tokens_out: j.llmTokensOut,
      total_processing_ms: j.totalProcessingMs,
    },
    extracted_data: j.extractedJson ? JSON.parse(j.extractedJson) : null,
    validation: j.validationJson ? JSON.parse(j.validationJson) : null,
    raw_ocr_text: j.ocrText,
    raw_llm_response: j.extractedJson,
    created_at: j.createdAt,
    completed_at: j.completedAt,
  })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext(req)
  if (!ctx || ctx.role === 'api') {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } }, { status: 401 })
  }
  const { id } = await params
  const existing = await getJobForOrg(id, ctx.organizationId)
  if (!existing) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Job not found' } }, { status: 404 })
  }
  try {
    await db.job.delete({ where: { id } })
    await logAudit({
      ctx,
      action: 'job.delete',
      resourceType: 'job',
      resourceId: id,
      metadata: { fileName: existing.fileName },
    })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Job not found' } }, { status: 404 })
  }
}
