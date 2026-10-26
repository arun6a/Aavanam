/**
 * /api/api-keys/[id]
 *   DELETE — revoke an API key (per BRD §3 US-06)
 *
 * "Revoked key is rejected immediately or within a documented short
 *  propagation window." — Our implementation rejects immediately (status
 *  flipped from 'active' to 'revoked' synchronously).
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
  const existing = await db.apiKey.findFirst({
    where: { id, organizationId: ctx.organizationId },
  })
  if (!existing) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'API key not found' } }, { status: 404 })
  }
  // Mark as revoked (don't delete — keep for audit history)
  await db.apiKey.update({
    where: { id },
    data: { status: 'revoked' },
  })
  await logAudit({
    ctx,
    action: 'apikey.revoke',
    resourceType: 'api_key',
    resourceId: id,
    metadata: { name: existing.name },
  })
  return NextResponse.json({ ok: true, status: 'revoked' })
}
