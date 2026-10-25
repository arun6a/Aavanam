/**
 * /api/templates
 *   GET    — list all templates
 *   POST   — create a new template
 *
 * Per BRD §6.1.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  serializeTemplateFields,
  deserializeTemplateFields,
  BUNDLED_TEMPLATES,
  type FieldDef,
} from '@/lib/templates/schema'

export async function GET() {
  const templates = await db.template.findMany({ orderBy: { createdAt: 'asc' } })
  return NextResponse.json({
    templates: templates.map(t => ({
      id: t.id,
      name: t.name,
      documentType: t.documentType,
      fields: deserializeTemplateFields(t.fieldsJson),
      instructions: t.instructions,
      isPublished: t.isPublished,
      version: t.version,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { name, documentType, fields, instructions } = body ?? {}

  if (!name || !Array.isArray(fields)) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'name and fields[] are required' } },
      { status: 422 },
    )
  }

  const t = await db.template.create({
    data: {
      name: String(name),
      documentType: String(documentType ?? 'invoice'),
      fieldsJson: serializeTemplateFields(fields as FieldDef[]),
      instructions: instructions ? String(instructions) : null,
    },
  })
  return NextResponse.json({
    id: t.id,
    name: t.name,
    documentType: t.documentType,
    fields: deserializeTemplateFields(t.fieldsJson),
    instructions: t.instructions,
  }, { status: 201 })
}

/**
 * POST /api/templates/seed — install all bundled starter templates if none exist.
 * Per BRD §3 US-03: starter templates help users see what's possible immediately.
 */
export async function PUT() {
  const existing = await db.template.count()
  if (existing > 0) {
    return NextResponse.json({ message: 'Templates already exist', count: existing })
  }
  const created = await Promise.all(
    BUNDLED_TEMPLATES.map(tpl =>
      db.template.create({
        data: {
          name: tpl.name,
          documentType: tpl.documentType,
          fieldsJson: serializeTemplateFields(tpl.fields),
          instructions: tpl.instructions,
        },
      })
    )
  )
  return NextResponse.json({
    message: `${created.length} starter templates seeded`,
    template_ids: created.map(t => t.id),
    template_names: created.map(t => t.name),
  }, { status: 201 })
}
