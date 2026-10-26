/**
 * POST /api/v1/api-keys
 *   Authorization: Bearer <existing_api_key_with_admin_scope>
 *
 * Per BRD §6.1 — POST /api/v1/api-keys: "Create a scoped API key; admin only."
 *
 * For MVP, all active API keys can create new ones. Production would parse
 * scopes (e.g. only "admin" scope keys can do this).
 *
 * Returns 201 with the full key (shown ONCE).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext, generateApiKey } from '@/lib/auth-context'
import { logAudit } from '@/lib/audit'

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req)
  if (!ctx) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header.' } }, { status: 401 })
  }
  if (ctx.role !== 'api') {
    // Only API-key callers can use the v1 path — web session users use /api/api-keys
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'This endpoint requires an API key, not a session.' } }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const name = (body.name as string | undefined)?.trim()
  const scopes = (body.scopes as string | undefined) ?? 'extract:write,extract:read,templates:read'

  if (!name) {
    return NextResponse.json({ error: { code: 'INVALID_INPUT', message: 'name is required' } }, { status: 422 })
  }

  const { key, prefix, hash } = generateApiKey()

  const record = await db.apiKey.create({
    data: {
      organizationId: ctx.organizationId,
      keyPrefix: prefix,
      secretHash: hash,
      name,
      scopes,
      status: 'active',
    },
  })

  await logAudit({
    ctx,
    action: 'apikey.create_api',
    resourceType: 'api_key',
    resourceId: record.id,
    metadata: { name, prefix, scopes, createdBy: ctx.actorId },
  })

  return NextResponse.json({
    id: record.id,
    key,  // full key — shown only here
    key_prefix: prefix,
    name,
    scopes,
    status: record.status,
    message: 'Save this key now — it will not be shown again.',
  }, { status: 201 })
}
