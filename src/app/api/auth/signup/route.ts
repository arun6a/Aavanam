/**
 * POST /api/auth/signup
 *   { email, password, name?, orgName? }
 *
 * Creates a new user + organization. The first user of an org is the admin.
 *
 * Per BRD §3 US-03 — user can register. Per BRD §5.1 — every record is scoped
 * to the owning organization.
 *
 * Returns 201 with the new user ID + org ID. Does NOT log the user in —
 * they must call /api/auth/callback/credentials separately to get a session.
 */

import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth-context'
import { logAudit } from '@/lib/audit'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const email = (body.email as string | undefined)?.toLowerCase().trim()
    const password = body.password as string | undefined
    const name = (body.name as string | undefined)?.trim() || null
    const orgName = (body.orgName as string | undefined)?.trim() || 'My Organization'

    if (!email || !password) {
      return NextResponse.json({ error: { code: 'INVALID_INPUT', message: 'email and password are required' } }, { status: 422 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: { code: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters' } }, { status: 422 })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: { code: 'INVALID_EMAIL', message: 'Invalid email format' } }, { status: 422 })
    }

    // Check if email already taken
    const existing = await db.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ error: { code: 'EMAIL_TAKEN', message: 'Email already registered' } }, { status: 409 })
    }

    // Create org + user + admin membership
    const passwordHash = hashPassword(password)
    const org = await db.organization.create({
      data: { name: orgName, status: 'active' },
    })
    const user = await db.user.create({
      data: { email, name, passwordHash, status: 'active' },
    })
    await db.organizationMember.create({
      data: { organizationId: org.id, userId: user.id, role: 'admin' },
    })

    await logAudit({
      ctx: { organizationId: org.id, actorType: 'user', actorId: user.id, role: 'admin' },
      action: 'auth.signup',
      resourceType: 'organization',
      resourceId: org.id,
      metadata: { email, orgName, userName: name },
    })

    return NextResponse.json({
      user_id: user.id,
      email: user.email,
      organization_id: org.id,
      organization_name: org.name,
      role: 'admin',
      message: 'Account created. Sign in with your email + password.',
    }, { status: 201 })
  } catch (e) {
    console.error('[signup] error:', e)
    return NextResponse.json({ error: { code: 'INTERNAL', message: e instanceof Error ? e.message : 'Unknown' } }, { status: 500 })
  }
}
