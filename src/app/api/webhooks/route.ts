/**
 * /api/webhooks
 *   GET  — list webhooks for current org
 *   POST — create a new webhook
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/auth-context'
import { logAudit } from '@/lib/audit'

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req)
  if (!ctx || ctx.role === 'api') {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } }, { status: 401 })
  }
  const webhooks = await db.webhook.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({
    webhooks: webhooks.map(w => ({
      id: w.id,
      url: w.url,
      events: w.events,
      status: w.status,
      lastTriggeredAt: w.lastTriggeredAt,
      lastResponseCode: w.lastResponseCode,
      createdAt: w.createdAt,
    })),
  })
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req)
  if (!ctx || ctx.role === 'api') {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  const url = (body.url as string | undefined)?.trim()
  const events = (body.events as string | undefined) ?? 'job.completed,job.failed,job.review_required'

  if (!url || !url.startsWith('http')) {
    return NextResponse.json({ error: { code: 'INVALID_INPUT', message: 'URL must start with http:// or https://' } }, { status: 422 })
  }

  const w = await db.webhook.create({
    data: {
      organizationId: ctx.organizationId,
      url,
      events,
      status: 'active',
    },
  })
  await logAudit({
    ctx,
    action: 'webhook.create',
    resourceType: 'webhook',
    resourceId: w.id,
    metadata: { url, events },
  })
  return NextResponse.json({
    id: w.id,
    url: w.url,
    events: w.events,
    status: w.status,
    createdAt: w.createdAt,
  }, { status: 201 })
}
