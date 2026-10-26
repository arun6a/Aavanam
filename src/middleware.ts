/**
 * Next.js middleware — applies to all /api/v1/* routes.
 *
 * Per BRD §5.1 + §6.5:
 *   - All public API routes require auth (Bearer token)
 *   - Rate limit: 60 req/min per identity
 *   - Request ID generation for tracing
 *
 * Internal routes (/api/* without /v1) are NOT rate-limited — they're for
 * logged-in web users and use the session cookie for auth.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'

export function middleware(req: NextRequest) {
  // Generate request ID for tracing
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()
  const res = NextResponse.next()
  res.headers.set('x-request-id', requestId)

  // Only apply to /api/v1/* public API
  if (!req.nextUrl.pathname.startsWith('/api/v1')) {
    return res
  }

  // Allow OPTIONS for CORS preflight
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Request-Id',
      },
    })
  }

  // Rate limit by IP (until auth resolves to API key inside the route)
  const identity = req.headers.get('authorization') ?? req.ip ?? 'unknown'
  if (!checkRateLimit(`rl:${identity}`)) {
    return NextResponse.json(
      {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Limit is 60 per minute.',
          request_id: requestId,
        },
      },
      {
        status: 429,
        headers: {
          'x-request-id': requestId,
          'Retry-After': '60',
        },
      },
    )
  }

  // Add CORS headers to all v1 responses
  res.headers.set('Access-Control-Allow-Origin', '*')
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id')

  return res
}

export const config = {
  // Run on all /api/v1/* routes
  matcher: '/api/v1/:path*',
}
