/**
 * POST /api/templates/[id]/publish
 *   Marks a template as published (immutable after this).
 *
 * Per BRD §3 US-04 — "Published version is immutable and can be selected
 * by ID/version."
 *
 * Per BRD §6 implementation rules — "Pin customer integrations to a published
 * template version."
 *
 * After publish:
 *   - PATCH endpoint refuses updates (returns 409)
 *   - The version is bumped (saved as the new version of the same row for MVP)
 *   - Future v2: save snapshot to TemplateVersion table (immutable history)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/auth-context'
import { logAudit } from '@/lib/audit'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext(req)
  if (!ctx || ctx.role === 'api') {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } }, { status: 401 })
  }
  const { id } = await params
  const existing = await db.template.findFirst({
    where: { id, organizationId: ctx.organizationId },
  })
  if (!existing) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Template not found' } }, { status: 404 })
  }

  // Bump version + mark published (immutable from now on)
  const updated = await db.template.update({
    where: { id },
    data: {
      isPublished: true,
      version: existing.version + 1,
    },
  })

  await logAudit({
    ctx,
    action: 'template.publish',
    resourceType: 'template',
    resourceId: updated.id,
    metadata: { name: updated.name, version: updated.version },
  })

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    document_type: updated.documentType,
    version: `${updated.version}.0`,
    is_published: true,
    published_at: updated.updatedAt,
  })
}
