/**
 * /api/jobs
 *   GET — list jobs (most recent first), with template name join
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  const jobs = await db.job.findMany({
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
      total_processing_ms: j.totalProcessingMs,
      created_at: j.createdAt,
      completed_at: j.completedAt,
      has_extracted_data: !!j.extractedJson,
    })),
  })
}
