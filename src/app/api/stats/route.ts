/**
 * /api/stats
 *   GET — dashboard statistics for current org
 *
 * Aggregates jobs / templates / api keys / audit events + per-day breakdown
 * for the last 30 days + by-template pie chart + cost estimate.
 *
 * Cost estimate is rough:
 *   - Z.ai GLM-4 (free in this preview) — cost = $0
 *   - OpenAI gpt-4o-mini would be $0.15 / 1M input tokens + $0.60 / 1M output
 *   - We assume gpt-4o-mini pricing for cost display so friend sees what
 *     production cost would look like.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/auth-context'

const COST_PER_MILLION_INPUT = 0.15   // OpenAI gpt-4o-mini input tokens
const COST_PER_MILLION_OUTPUT = 0.60  // OpenAI gpt-4o-mini output tokens

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req)
  if (!ctx) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } }, { status: 401 })
  }

  const orgFilter = { organizationId: ctx.organizationId }

  // Total counts
  const [jobs, templates, apiKeys, auditEvents] = await Promise.all([
    db.job.count({ where: orgFilter }),
    db.template.count({ where: orgFilter }),
    db.apiKey.count({ where: orgFilter }),
    db.auditLog.count({ where: orgFilter }),
  ])

  // Status breakdown
  const completed = await db.job.count({ where: { ...orgFilter, status: 'completed' } })
  const review_required = await db.job.count({ where: { ...orgFilter, status: 'review_required' } })
  const failed = await db.job.count({ where: { ...orgFilter, status: 'failed' } })

  // Recent jobs for cost + processing time
  const recentJobs = await db.job.findMany({
    where: { ...orgFilter, status: { in: ['completed', 'review_required', 'failed'] } },
    select: {
      llmTokensIn: true,
      llmTokensOut: true,
      totalProcessingMs: true,
      templateId: true,
      template: { select: { name: true } },
      createdAt: true,
      status: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  // Cost estimate
  const llmTokensIn = recentJobs.reduce((s, j) => s + (j.llmTokensIn ?? 0), 0)
  const llmTokensOut = recentJobs.reduce((s, j) => s + (j.llmTokensOut ?? 0), 0)
  const estimatedCostUsd =
    (llmTokensIn / 1_000_000) * COST_PER_MILLION_INPUT +
    (llmTokensOut / 1_000_000) * COST_PER_MILLION_OUTPUT

  // Avg processing time (skip nulls)
  const validProcessingTimes = recentJobs
    .map(j => j.totalProcessingMs)
    .filter((v): v is number => v != null)
  const avgProcessingMs = validProcessingTimes.length > 0
    ? Math.round(validProcessingTimes.reduce((a, b) => a + b, 0) / validProcessingTimes.length)
    : null

  // Success rate (completed / (completed + failed))
  const successRate = (completed + failed) > 0 ? completed / (completed + failed) : 0

  // Last 30 days breakdown
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const last30DaysRaw = await db.job.findMany({
    where: { ...orgFilter, createdAt: { gte: thirtyDaysAgo } },
    select: { createdAt: true, status: true },
    orderBy: { createdAt: 'asc' },
  })
  // Group by day
  const dayMap = new Map<string, { jobs: number; completed: number; failed: number }>()
  for (const j of last30DaysRaw) {
    const day = j.createdAt.toISOString().slice(0, 10)  // YYYY-MM-DD
    const entry = dayMap.get(day) ?? { jobs: 0, completed: 0, failed: 0 }
    entry.jobs++
    if (j.status === 'completed') entry.completed++
    else if (j.status === 'failed') entry.failed++
    dayMap.set(day, entry)
  }
  // Fill in missing days with zeros + sort ascending
  const last30Days: Array<{ date: string; jobs: number; completed: number; failed: number }> = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const day = d.toISOString().slice(0, 10)
    last30Days.push({ date: day, ...(dayMap.get(day) ?? { jobs: 0, completed: 0, failed: 0 }) })
  }

  // By template breakdown
  const byTemplateMap = new Map<string, number>()
  for (const j of recentJobs) {
    byTemplateMap.set(j.template.name, (byTemplateMap.get(j.template.name) ?? 0) + 1)
  }
  const by_template = Array.from(byTemplateMap.entries()).map(([name, count]) => ({ name, count }))

  // Recent activity (last 10 jobs)
  const recentActivityRaw = await db.job.findMany({
    where: orgFilter,
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: { template: true },
  })
  const recent_activity = recentActivityRaw.map(j => ({
    id: j.id,
    file_name: j.fileName,
    template_name: j.template.name,
    status: j.status,
    ocr_engine: j.ocrEngine,
    total_processing_ms: j.totalProcessingMs,
    created_at: j.createdAt,
    has_extracted_data: !!j.extractedJson,
  }))

  return NextResponse.json({
    totals: {
      jobs,
      completed,
      review_required,
      failed,
      templates,
      api_keys: apiKeys,
      audit_events: auditEvents,
    },
    by_template,
    last_30_days: last30Days,
    recent_activity,
    cost: {
      llm_tokens_in: llmTokensIn,
      llm_tokens_out: llmTokensOut,
      estimated_cost_usd: estimatedCostUsd,
    },
    avg_processing_ms: avgProcessingMs,
    success_rate: successRate,
  })
}
