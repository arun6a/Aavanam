/**
 * PATCH /api/v1/templates/[id]
 *   Authorization: Bearer <api_key>
 *
 * Per BRD §6.1 — PATCH /api/v1/templates/{template_id}: "Update a draft template."
 *
 * Note: BRD says templates are typically managed by web users via the
 * template builder UI. This public PATCH endpoint is for advanced API
 * consumers who want to update templates programmatically. Refuses if
 * template is already published.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/auth-context'
import { logAudit } from '@/lib/audit'
import {
  serializeTemplateFields,
  deserializeTemplateFields,
  type FieldDef,
} from '@/lib/templates/schema'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext(req)
  if (!ctx) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header.' } }, { status: 401 })
  }
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { name, documentType, fields, instructions } = body ?? {}

  const existing = await db.template.findFirst({
    where: { id, organizationId: ctx.organizationId },
  })
  if (!existing) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Template not found' } }, { status: 404 })
  }
  if (existing.isPublished) {
    return NextResponse.json({
      error: { code: 'TEMPLATE_PUBLISHED', message: 'Published templates are immutable. Create a new version instead.' },
    }, { status: 409 })
  }

  const updated = await db.template.update({
    where: { id },
    data: {
      ...(name ? { name: String(name) } : {}),
      ...(documentType ? { documentType: String(documentType) } : {}),
      ...(Array.isArray(fields) ? { fieldsJson: serializeTemplateFields(fields as FieldDef[]) } : {}),
      ...(instructions !== undefined ? { instructions: String(instructions) } : {}),
    },
  })

  await logAudit({
    ctx,
    action: 'template.update_api',
    resourceType: 'template',
    resourceId: updated.id,
    metadata: { name: updated.name, by_api_key: ctx.actorId },
  })

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    document_type: updated.documentType,
    fields: deserializeTemplateFields(updated.fieldsJson),
    instructions: updated.instructions,
    version: `${updated.version}.0`,
    updated_at: updated.updatedAt,
  })
}
