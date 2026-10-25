/**
 * GET /api/v1/extractions/{job_id}
 *   Authorization: Bearer <api_key>
 *
 * Poll status + retrieve result.
 *
 * Returns 200 with job state. While status is 'queued' or 'processing',
 * `extracted_data` is null. When status is 'completed' or 'review_required',
 * the full extracted JSON + validation are included.
 *
 * Per BRD §6.4 — example result shape.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/auth-context'
import { deserializeTemplateFields } from '@/lib/templates/schema'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext(req)
  if (!ctx) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header.' } }, { status: 401 })
  }
  const { id } = await params
  const job = await db.job.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: { template: true },
  })
  if (!job) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Job not found' } }, { status: 404 })
  }

  return NextResponse.json({
    job_id: job.id,
    status: job.status,
    template: {
      id: job.template.id,
      name: job.template.name,
      version: `${job.template.version}.0`,
    },
    file_name: job.fileName,
    file_size: job.fileSize,
    mime_type: job.mimeType,
    stage: job.stage,
    error_message: job.errorMessage,
    error_code: job.errorCode,
    multi_invoice: job.multiInvoice,
    document_count: job.documentCount,
    data: job.extractedJson ? JSON.parse(job.extractedJson) : null,
    validation: job.validationJson ? JSON.parse(job.validationJson) : null,
    diagnostics: {
      ocr_engine: job.ocrEngine,
      ocr_confidence: job.ocrConfidence,
      ocr_time_ms: job.ocrTimeMs,
      pdf_text_length: job.pdfTextLength,
      pdf_time_ms: job.pdfTimeMs,
      llm_model: job.llmModel,
      llm_time_ms: job.llmTimeMs,
      llm_tokens_in: job.llmTokensIn,
      llm_tokens_out: job.llmTokensOut,
      total_processing_ms: job.totalProcessingMs,
    },
    created_at: job.createdAt,
    completed_at: job.completedAt,
  })
}
