/**
 * /api/audit-logs
 *   GET — list audit logs for current org (most recent first, max 100)
 *
 * Returns actor info joined where possible (user email for user actions).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/auth-context'

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req)
  if (!ctx || ctx.role === 'api') {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } }, { status: 401 })
  }
  const logs = await db.auditLog.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { timestamp: 'desc' },
    take: 100,
    include: { user: true },
  })
  return NextResponse.json({
    logs: logs.map(l => ({
      id: l.id,
      actorType: l.actorType,
      actorEmail: l.user?.email ?? null,
      action: l.action,
      resourceType: l.resourceType,
      resourceId: l.resourceId,
      metadata: l.metadataJson ? JSON.parse(l.metadataJson) : null,
      timestamp: l.timestamp,
    })),
  })
}
