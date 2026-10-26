/**
 * Rate limiter — in-memory, per-API-key + per-IP for unauthenticated.
 *
 * Per BRD §6.5 — "Return standard errors for 429 cases."
 *
 * MVP: 60 requests per minute per identity (API key or IP).
 * Production would use Redis for distributed rate limiting.
 *
 * Sliding window: 60-second window, count per identity.
 */

type RateBucket = { count: number; windowStart: number }
const buckets = new Map<string, RateBucket>()

const WINDOW_MS = 60_000  // 1 minute
const MAX_PER_WINDOW = 60  // 60 req/min

/** Check + increment rate limit. Returns true if allowed, false if exceeded. */
export function checkRateLimit(identity: string, limit: number = MAX_PER_WINDOW): boolean {
  const now = Date.now()
  const bucket = buckets.get(identity)
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(identity, { count: 1, windowStart: now })
    return true
  }
  if (bucket.count >= limit) {
    return false
  }
  bucket.count++
  return true
}

/** Cleanup old buckets — call periodically to prevent memory growth. */
export function cleanupRateBuckets(): void {
  const now = Date.now()
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.windowStart > WINDOW_MS * 2) {
      buckets.delete(key)
    }
  }
}

// Run cleanup every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupRateBuckets, 5 * 60 * 1000).unref?.()
}
