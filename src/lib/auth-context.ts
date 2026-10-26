/**
 * Auth helpers for API routes.
 *
 * Two ways to authenticate API routes:
 *   1. Session (web UI user): getServerSession(authOptions) → JWT in cookie
 *   2. API Key (external integrations): Authorization: Bearer <key> header
 *
 * All Aavanam data is scoped by organization. Both auth methods resolve to
 * the same shape: { organizationId, actorType, actorId, role }.
 */

import { getServerSession } from 'next-auth'
import bcrypt from 'bcryptjs'
import type { NextRequest } from 'next/server'
import { authOptions, type AppSession } from '@/lib/auth'
import { db } from '@/lib/db'

export type AuthContext = {
  organizationId: string
  actorType: 'user' | 'api_key' | 'system'
  actorId: string | null  // user ID for user actions, api_key ID for API key actions
  role: 'admin' | 'member' | 'api'  // 'api' for API-key calls (extract + read scope)
}

/**
 * Resolve the auth context for a request — try session first, then API key.
 * Returns null if neither auth method succeeds.
 */
export async function getAuthContext(req?: NextRequest): Promise<AuthContext | null> {
  // 1. Try session (logged-in web user)
  const session = await getServerSession(authOptions) as AppSession | null
  if (session?.user?.id && session.user.organizationId) {
    return {
      organizationId: session.user.organizationId,
      actorType: 'user',
      actorId: session.user.id,
      role: (session.user.role as 'admin' | 'member') ?? 'member',
    }
  }

  // 2. Try API key (Authorization: Bearer <key>)
  if (req) {
    const authHeader = req.headers.get('authorization') ?? ''
    if (authHeader.startsWith('Bearer ')) {
      const key = authHeader.slice('Bearer '.length).trim()
      const ctx = await resolveApiKey(key)
      if (ctx) return ctx
    }
  }

  return null
}

/**
 * Validate an API key against the database. Returns the auth context if valid,
 * null otherwise.
 *
 * The API key format on creation: `aava_<random>` where the random part is 32 chars.
 * We store the bcrypt hash; the prefix `aava_` is visible in the UI to identify keys.
 */
async function resolveApiKey(key: string): Promise<AuthContext | null> {
  // Key format: aava_<random>
  if (!key.startsWith('aava_')) return null
  const prefix = key.slice(0, 12)  // first 12 chars shown in UI as key_prefix
  // Look up keys with matching prefix (we can't query by hash directly — bcrypt hashes are unique per salt)
  const candidates = await db.apiKey.findMany({
    where: { status: 'active', keyPrefix: prefix },
  })
  for (const candidate of candidates) {
    if (candidate.expiresAt && candidate.expiresAt < new Date()) continue
    const ok = await bcrypt.compare(key, candidate.secretHash)
    if (ok) {
      // Update lastUsedAt in background (don't block)
      db.apiKey.update({
        where: { id: candidate.id },
        data: { lastUsedAt: new Date() },
      }).catch(() => {})
      return {
        organizationId: candidate.organizationId,
        actorType: 'api_key',
        actorId: candidate.id,
        role: 'api',
      }
    }
  }
  return null
}

/**
 * Generate a new API key. Returns the full key (only shown ONCE to the user)
 * + stores the bcrypt hash + prefix in the DB.
 *
 * Format: aava_<32 random chars from base62>
 */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let random = ''
  for (let i = 0; i < 32; i++) {
    random += chars[Math.floor(Math.random() * chars.length)]
  }
  const key = `aava_${random}`
  const prefix = key.slice(0, 12)
  const hash = bcrypt.hashSync(key, 10)
  return { key, prefix, hash }
}

/**
 * Hash a password for storage (used by the seed script + signup flow).
 */
export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10)
}
