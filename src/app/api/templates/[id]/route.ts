/**
 * /api/templates/[id]
 *   GET    — get one template
 *   PATCH  — update a draft template (BRD says published versions are immutable)
 *   DELETE — delete a template (cascade-deletes its jobs)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  serializeTemplateFields,
  deserializeTemplateFields,
  type FieldDef,
} from '@/lib/templates/schema'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const t = await db.template.findUnique({ where: { id } })
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
  const { id } = await params
  const body = await req.json()
  const { name, documentType, fields, instructions } = body ?? {}

  const existing = await db.template.findUnique({ where: { id } })
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
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    await db.template.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Template not found' } }, { status: 404 })
  }
}
