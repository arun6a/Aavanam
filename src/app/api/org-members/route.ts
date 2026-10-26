/**
 * /api/org-members
 *   GET  — list members of current org (admin only)
 *   POST — invite a member by email (admin only)
 *          If the user already exists in the system, adds them as a member.
 *          If not, returns 404 with a "send signup link" message.
 *
 * Per BRD §7 — organizations, users, organization_members.
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
  if (ctx.role !== 'admin') {
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Admin role required to list members.' } }, { status: 403 })
  }
  const members = await db.organizationMember.findMany({
    where: { organizationId: ctx.organizationId },
    include: { user: true },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({
    members: members.map(m => ({
      id: m.id,
      user_id: m.userId,
      email: m.user.email,
      name: m.user.name,
      role: m.role,
      status: m.user.status,
      joined_at: m.createdAt,
    })),
  })
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req)
  if (!ctx || ctx.role === 'api') {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } }, { status: 401 })
  }
  if (ctx.role !== 'admin') {
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Admin role required to invite members.' } }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  const email = (body.email as string | undefined)?.toLowerCase().trim()
  const role = (body.role as string | undefined) ?? 'member'
  if (!email) {
    return NextResponse.json({ error: { code: 'INVALID_INPUT', message: 'email is required' } }, { status: 422 })
  }
  if (role !== 'admin' && role !== 'member') {
    return NextResponse.json({ error: { code: 'INVALID_ROLE', message: 'role must be "admin" or "member"' } }, { status: 422 })
  }

  // Find existing user by email
  const user = await db.user.findUnique({ where: { email } })
  if (!user) {
    return NextResponse.json({
      error: {
        code: 'USER_NOT_FOUND',
        message: `No user with email ${email}. Ask them to sign up first at the app's login page.`,
      },
    }, { status: 404 })
  }

  // Check if already a member
  const existing = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: ctx.organizationId, userId: user.id } },
  })
  if (existing) {
    return NextResponse.json({ error: { code: 'ALREADY_MEMBER', message: `${email} is already a member.` } }, { status: 409 })
  }

  const member = await db.organizationMember.create({
    data: { organizationId: ctx.organizationId, userId: user.id, role },
  })

  await logAudit({
    ctx,
    action: 'org.member_add',
    resourceType: 'organization_member',
    resourceId: member.id,
    metadata: { email, role },
  })

  return NextResponse.json({
    id: member.id,
    user_id: user.id,
    email: user.email,
    role,
    message: `${email} added as ${role}`,
  }, { status: 201 })
}
