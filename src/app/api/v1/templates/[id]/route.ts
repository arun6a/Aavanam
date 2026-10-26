/**
 * GET /api/v1/templates/{id}
 *   Authorization: Bearer <api_key>
 * Get one template's details.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/auth-context'
import { deserializeTemplateFields } from '@/lib/templates/schema'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext(req)
  if (!ctx) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header.' } }, { status: 401 })
  }
  const { id } = await params
  const t = await db.template.findFirst({
    where: { id, organizationId: ctx.organizationId },
  })
  if (!t) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Template not found' } }, { status: 404 })
  }
  return NextResponse.json({
    id: t.id,
    name: t.name,
    documentType: t.documentType,
    version: `${t.version}.0`,
    fields: deserializeTemplateFields(t.fieldsJson),
    instructions: t.instructions,
    isPublished: t.isPublished,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  })
}
