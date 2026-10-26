/**
 * DELETE /api/v1/api-keys/[id]
 *   Authorization: Bearer <api_key>
 *
 * Per BRD §6.1 + §3 US-06 — "Revoked key is rejected immediately."
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
  if (!ctx) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header.' } }, { status: 401 })
  }
  const { id } = await params
  const existing = await db.apiKey.findFirst({
    where: { id, organizationId: ctx.organizationId },
  })
  if (!existing) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'API key not found' } }, { status: 404 })
  }
  await db.apiKey.update({
    where: { id },
    data: { status: 'revoked' },
  })
  await logAudit({
    ctx,
    action: 'apikey.revoke_api',
    resourceType: 'api_key',
    resourceId: id,
    metadata: { name: existing.name, revoked_by: ctx.actorId },
  })
  return NextResponse.json({ ok: true, status: 'revoked' })
}
