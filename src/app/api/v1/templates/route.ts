/**
 * GET /api/v1/templates
 *   Authorization: Bearer <api_key>
 * List templates for the API key's org.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/auth-context'
import { deserializeTemplateFields } from '@/lib/templates/schema'

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req)
  if (!ctx) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header.' } }, { status: 401 })
  }
  const templates = await db.template.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, name: true, documentType: true, fieldsJson: true,
      instructions: true, isPublished: true, version: true,
      createdAt: true, updatedAt: true,
    },
  })
  return NextResponse.json({
    templates: templates.map(t => ({
      id: t.id,
      name: t.name,
      documentType: t.documentType,
      version: `${t.version}.0`,
      fields: deserializeTemplateFields(t.fieldsJson),
      instructions: t.instructions,
      isPublished: t.isPublished,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
  })
}
