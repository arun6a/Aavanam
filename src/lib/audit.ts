/**
 * Audit log helper — fire-and-forget writes to the AuditLog table.
 *
 * Per BRD §8 — "Redact sensitive values from logs; never log full document text,
 * credentials or raw API keys." Only safe metadata is logged.
 *
 * Common actions:
 *   auth.login, auth.logout
 *   template.create, template.update, template.delete, template.publish
 *   job.submit, job.complete, job.fail, job.delete
 *   apikey.create, apikey.revoke
 *   webhook.create, webhook.update, webhook.delete, webhook.fire
 */

import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth-context'

type AuditEvent = {
  ctx: AuthContext
  action: string
  resourceType?: string
  resourceId?: string
  requestId?: string
  metadata?: Record<string, unknown>
}

/**
 * Write an audit log entry. Never throws — audit logging should never break
 * the main operation.
 */
export async function logAudit(event: AuditEvent): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        organizationId: event.ctx.organizationId,
        actorId: event.ctx.actorId,
        actorType: event.ctx.actorType,
        action: event.action,
        resourceType: event.resourceType ?? null,
        resourceId: event.resourceId ?? null,
        requestId: event.requestId ?? null,
        metadataJson: event.metadata ? JSON.stringify(event.metadata) : null,
      },
    })
  } catch (e) {
    console.error('[audit] failed to log:', e)
  }
}
