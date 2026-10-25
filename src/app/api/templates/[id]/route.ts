/**
 * /api/templates/[id]
 *   GET    — get one template (must belong to current org)
 *   PATCH  — update a draft template
 *   DELETE — delete a template (cascade-deletes jobs)
 *
 * Per BRD §5.1 — organization-scoped access enforced on every query.
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

async function getTemplateForOrg(templateId: string, organizationId: string) {
  return db.template.findFirst({ where: { id: templateId, organizationId } })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext(req)
  if (!ctx) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } }, { status: 401 })
  }
  const { id } = await params
  const t = await getTemplateForOrg(id, ctx.organizationId)
  if (!t) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Template not found' } }, { status: 404 })
  }
  return NextResponse.json({
    id: t.id,
    name: t.name,
    documentType: t.documentType,
    fields: deserializeTemplateFields(t.fieldsJson),
    instructions: t.instructions,
    isPublished: t.isPublished,
    version: t.version,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext(req)
  if (!ctx || ctx.role === 'api') {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } }, { status: 401 })
  }
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { name, documentType, fields, instructions } = body ?? {}

  const existing = await getTemplateForOrg(id, ctx.organizationId)
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
    action: 'template.update',
    resourceType: 'template',
    resourceId: updated.id,
    metadata: { name: updated.name },
  })

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    documentType: updated.documentType,
    fields: deserializeTemplateFields(updated.fieldsJson),
    instructions: updated.instructions,
    updatedAt: updated.updatedAt,
  })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext(req)
  if (!ctx || ctx.role === 'api') {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } }, { status: 401 })
  }
  const { id } = await params
  const existing = await getTemplateForOrg(id, ctx.organizationId)
  if (!existing) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Template not found' } }, { status: 404 })
  }
  try {
    await db.template.delete({ where: { id } })
    await logAudit({
      ctx,
      action: 'template.delete',
      resourceType: 'template',
      resourceId: id,
      metadata: { name: existing.name },
    })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Template not found' } }, { status: 404 })
  }
}
