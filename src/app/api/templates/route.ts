/**
 * /api/templates
 *   GET    — list templates for the current org
 *   POST   — create new template (current org)
 *   PUT    — seed bundled templates if none exist for current org
 *
 * Per BRD §5.1 — every record is scoped to the owning organization.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/auth-context'
import { logAudit } from '@/lib/audit'
import {
  serializeTemplateFields,
  deserializeTemplateFields,
  BUNDLED_TEMPLATES,
  type FieldDef,
} from '@/lib/templates/schema'

export async function GET() {
  const ctx = await getAuthContext()
  if (!ctx) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } }, { status: 401 })
  }
  const templates = await db.template.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: 'asc' },
  })
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
  const ctx = await getAuthContext(req)
  if (!ctx) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } }, { status: 401 })
  }
  if (ctx.role === 'api' && !ctx.actorId) {
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'API keys cannot create templates.' } }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { name, documentType, fields, instructions } = body ?? {}

  if (!name || !Array.isArray(fields)) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'name and fields[] are required' } },
      { status: 422 },
    )
  }

  const t = await db.template.create({
    data: {
      organizationId: ctx.organizationId,
      name: String(name),
      documentType: String(documentType ?? 'invoice'),
      fieldsJson: serializeTemplateFields(fields as FieldDef[]),
      instructions: instructions ? String(instructions) : null,
    },
  })

  await logAudit({
    ctx,
    action: 'template.create',
    resourceType: 'template',
    resourceId: t.id,
    metadata: { name: t.name, documentType: t.documentType, fieldCount: (fields as FieldDef[]).length },
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
 * PUT — seed bundled templates for the current org if none exist.
 * (Idempotent — skips if org already has templates.)
 */
export async function PUT(req: NextRequest) {
  const ctx = await getAuthContext(req)
  if (!ctx) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } }, { status: 401 })
  }
  const existing = await db.template.count({ where: { organizationId: ctx.organizationId } })
  if (existing > 0) {
    return NextResponse.json({ message: 'Templates already exist', count: existing })
  }
  const created = await Promise.all(
    BUNDLED_TEMPLATES.map(tpl =>
      db.template.create({
        data: {
          organizationId: ctx.organizationId,
          name: tpl.name,
          documentType: tpl.documentType,
          fieldsJson: serializeTemplateFields(tpl.fields),
          instructions: tpl.instructions,
        },
      })
    )
  )
  for (const t of created) {
    await logAudit({
      ctx,
      action: 'template.seed',
      resourceType: 'template',
      resourceId: t.id,
      metadata: { name: t.name },
    })
  }
  return NextResponse.json({
    message: `${created.length} starter templates seeded`,
    template_ids: created.map(t => t.id),
    template_names: created.map(t => t.name),
  }, { status: 201 })
}
