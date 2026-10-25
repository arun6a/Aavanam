/**
 * /api/jobs
 *   GET — list jobs for current org (most recent first, max 100)
 */

import { NextResponse, NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/auth-context'

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req)
  if (!ctx) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in or pass an API key.' } }, { status: 401 })
  }
  const jobs = await db.job.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { template: true },
  })
  return NextResponse.json({
    jobs: jobs.map(j => ({
      id: j.id,
      template_id: j.templateId,
      template_name: j.template.name,
      file_name: j.fileName,
      file_size: j.fileSize,
      mime_type: j.mimeType,
      status: j.status,
      stage: j.stage,
      ocr_engine: j.ocrEngine,
      ocr_confidence: j.ocrConfidence,
      llm_model: j.llmModel,
      llm_tokens_in: j.llmTokensIn,
      llm_tokens_out: j.llmTokensOut,
      multi_invoice: j.multiInvoice,
      document_count: j.documentCount,
      total_processing_ms: j.totalProcessingMs,
      created_at: j.createdAt,
      completed_at: j.completedAt,
      has_extracted_data: !!j.extractedJson,
    })),
  })
}
