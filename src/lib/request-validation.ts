/**
 * Request validation helper — per BRD §6.5 "Return standard errors for
 * 400, 422, 429 cases."
 *
 * Use in API routes:
 *   const validation = validateApiRequest(req, {
 *     requireFile: true,
 *     requireFields: ['templateId'],
 *     maxFileSize: 10 * 1024 * 1024,
 *   })
 *   if (!validation.ok) return validation.response
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

type ValidationOptions = {
  requireFile?: boolean
  requireFields?: string[]  // form-data fields that must be present
  maxFileSize?: number  // bytes
}

type ValidationResult = {
  ok: boolean
  response?: NextResponse
}

export function errorResponse(code: string, message: string, status: number, requestId?: string) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        request_id: requestId ?? null,
      },
    },
    { status },
  )
}

export async function validateApiRequest(
  req: NextRequest,
  opts: ValidationOptions = {},
): Promise<ValidationResult> {
  const requestId = req.headers.get('x-request-id') ?? null

  // Content-Type check
  const contentType = req.headers.get('content-type') ?? ''
  const isMultipart = contentType.includes('multipart/form-data')
  const isJson = contentType.includes('application/json')

  if (opts.requireFile && !isMultipart) {
    return {
      ok: false,
      response: errorResponse('INVALID_CONTENT_TYPE', `Expected multipart/form-data, got ${contentType || 'none'}`, 400, requestId ?? undefined),
    }
  }

  // File size check (read content-length header — fast, doesn't read body)
  if (opts.maxFileSize) {
    const contentLength = parseInt(req.headers.get('content-length') ?? '0', 10)
    if (contentLength > opts.maxFileSize) {
      return {
        ok: false,
        response: errorResponse('FILE_TOO_LARGE', `Max size is ${opts.maxFileSize / 1024 / 1024} MB`, 413, requestId ?? undefined),
      }
    }
  }

  // Required form-data fields check
  if (opts.requireFields && opts.requireFields.length > 0) {
    if (!isMultipart) {
      return {
        ok: false,
        response: errorResponse('INVALID_CONTENT_TYPE', 'Expected multipart/form-data for required fields', 400, requestId ?? undefined),
      }
    }
    // We can't peek at form-data without consuming the body here — defer to the route.
    // Routes that use requireFields should check after reading formData.
  }

  return { ok: true }
}

/**
 * Validate that required form-data fields are present after parsing.
 * Returns null if valid, or a NextResponse with 422 if missing.
 */
export function validateFormFields(
  formData: FormData,
  requiredFields: string[],
  requestId?: string,
): NextResponse | null {
  const missing: string[] = []
  for (const field of requiredFields) {
    if (!formData.get(field)) {
      missing.push(field)
    }
  }
  if (missing.length > 0) {
    return errorResponse('MISSING_FIELDS', `Required fields missing: ${missing.join(', ')}`, 422, requestId)
  }
  return null
}
