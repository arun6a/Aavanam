/**
 * /api/jobs/[id]
 *   GET — get one job with full result + validation
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { deserializeTemplateFields } from '@/lib/templates/schema'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const j = await db.job.findUnique({
    where: { id },
    include: { template: true },
  })
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
    raw_llm_response: j.extractedJson,  // we stored the parsed JSON, not the raw response
    created_at: j.createdAt,
    completed_at: j.completedAt,
  })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    await db.job.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Job not found' } }, { status: 404 })
  }
}
