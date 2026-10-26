/**
 * /api/org-members/[id]
 *   PATCH  — change a member's role (admin only)
 *   DELETE — remove a member (admin only, can't remove self)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/auth-context'
import { logAudit } from '@/lib/audit'

async function findMember(memberId: string, orgId: string) {
  return db.organizationMember.findFirst({
    where: { id: memberId, organizationId: orgId },
    include: { user: true },
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext(req)
  if (!ctx || ctx.role !== 'admin') {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Admin role required.' } }, { status: 401 })
  }
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const role = body.role as string | undefined
  if (role !== 'admin' && role !== 'member') {
    return NextResponse.json({ error: { code: 'INVALID_ROLE', message: 'role must be "admin" or "member"' } }, { status: 422 })
  }

  const existing = await findMember(id, ctx.organizationId)
  if (!existing) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Member not found' } }, { status: 404 })
  }

  const updated = await db.organizationMember.update({
    where: { id },
    data: { role },
  })
  await logAudit({
    ctx,
    action: 'org.member_role_change',
    resourceType: 'organization_member',
    resourceId: id,
    metadata: { email: existing.user.email, newRole: role, oldRole: existing.role },
  })
  return NextResponse.json({
    id: updated.id,
    user_id: updated.userId,
    email: existing.user.email,
    role: updated.role,
  })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext(req)
  if (!ctx || ctx.role !== 'admin') {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Admin role required.' } }, { status: 401 })
  }
  const { id } = await params
  const existing = await findMember(id, ctx.organizationId)
  if (!existing) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Member not found' } }, { status: 404 })
  }
  // Prevent self-removal
  if (existing.userId === ctx.actorId) {
    return NextResponse.json({ error: { code: 'CANNOT_REMOVE_SELF', message: 'Cannot remove yourself from the org. Ask another admin.' } }, { status: 409 })
  }
  // Prevent removing the last admin
  if (existing.role === 'admin') {
    const adminCount = await db.organizationMember.count({
      where: { organizationId: ctx.organizationId, role: 'admin' },
    })
    if (adminCount <= 1) {
      return NextResponse.json({ error: { code: 'LAST_ADMIN', message: 'Cannot remove the last admin. Promote another member first.' } }, { status: 409 })
    }
  }

  await db.organizationMember.delete({ where: { id } })
  await logAudit({
    ctx,
    action: 'org.member_remove',
    resourceType: 'organization_member',
    resourceId: id,
    metadata: { email: existing.user.email, role: existing.role },
  })
  return NextResponse.json({ ok: true, removed: existing.user.email })
}
