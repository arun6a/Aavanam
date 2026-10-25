/**
 * /api/api-keys
 *   GET  — list API keys for current org (no secret hash revealed)
 *   POST — generate a new API key (secret shown ONCE in response)
 *
 * Per BRD §6.1 — "Customer-scoped API key, template ID/version".
 * Per BRD §6.5 rules — "Store API key hashes, not plaintext secrets; show
 * the full key only once."
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext, generateApiKey } from '@/lib/auth-context'
import { logAudit } from '@/lib/audit'

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req)
  if (!ctx || ctx.role === 'api') {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } }, { status: 401 })
  }
  const keys = await db.apiKey.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({
    keys: keys.map(k => ({
      id: k.id,
      keyPrefix: k.keyPrefix,
      name: k.name,
      scopes: k.scopes,
      status: k.status,
      lastUsedAt: k.lastUsedAt,
      expiresAt: k.expiresAt,
      createdAt: k.createdAt,
    })),
  })
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req)
  if (!ctx || ctx.role === 'api') {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  const name = (body.name as string | undefined)?.trim()
  const scopes = (body.scopes as string | undefined) ?? 'extract:write,extract:read,templates:read'

  if (!name) {
    return NextResponse.json({ error: { code: 'INVALID_INPUT', message: 'name is required' } }, { status: 422 })
  }

  // Generate the key + bcrypt hash + 12-char prefix for UI display
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
    action: 'apikey.create',
    resourceType: 'api_key',
    resourceId: record.id,
    metadata: { name, prefix, scopes },
  })

  // Return the FULL key once — the user must save it now.
  return NextResponse.json({
    id: record.id,
    key,  // full key — shown only here
    keyPrefix: prefix,
    name,
    scopes,
    status: record.status,
    message: 'Save this key now — it will not be shown again.',
  }, { status: 201 })
}
