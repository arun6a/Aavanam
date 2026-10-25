/**
 * /api/webhooks/[id]
 *   DELETE — delete a webhook
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/auth-context'
import { logAudit } from '@/lib/audit'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext(req)
  if (!ctx || ctx.role === 'api') {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } }, { status: 401 })
  }
  const { id } = await params
  const existing = await db.webhook.findFirst({
    where: { id, organizationId: ctx.organizationId },
  })
  if (!existing) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Webhook not found' } }, { status: 404 })
  }
  await db.webhook.delete({ where: { id } })
  await logAudit({
    ctx,
    action: 'webhook.delete',
    resourceType: 'webhook',
    resourceId: id,
    metadata: { url: existing.url },
  })
  return NextResponse.json({ ok: true })
}
