/**
 * Webhook delivery — fire-and-forget POST to registered webhook URLs.
 *
 * Per BRD §6 — webhook signatures and event IDs if webhooks are added.
 * We sign the body with HMAC SHA-256 using the webhook's secret (if set).
 *
 * The signature is sent in the `X-Aavanam-Signature` header as
 * `sha256=<hex>`. The receiver recomputes HMAC SHA-256 of the body
 * with the same secret and compares.
 *
 * Delivery is fire-and-forget — failures are logged in the DB but don't
 * block the main job flow. Production would add retry with backoff + DLQ.
 */

import crypto from 'crypto'
import { db } from '@/lib/db'

type WebhookPayload = {
  event: string  // job.completed | job.failed | job.review_required
  job_id: string
  organization_id: string
  status: string
  timestamp: string
}

/**
 * Fire webhooks for a job's organization, filtered by event type.
 * Updates each webhook's lastTriggeredAt + lastResponseCode.
 */
export async function fireWebhooksForJob(jobId: string, event: string): Promise<void> {
  try {
    const job = await db.job.findUnique({ where: { id: jobId }, select: { organizationId: true, status: true } })
    if (!job) return

    const webhooks = await db.webhook.findMany({
      where: { organizationId: job.organizationId, status: 'active' },
    })
    if (webhooks.length === 0) return

    const payload: WebhookPayload = {
      event,
      job_id: jobId,
      organization_id: job.organizationId,
      status: job.status,
      timestamp: new Date().toISOString(),
    }
    const body = JSON.stringify(payload)

    for (const hook of webhooks) {
      // Check if event matches
      const hookEvents = hook.events.split(',').map(e => e.trim())
      if (!hookEvents.includes(event)) continue

      // Sign if secret is set
      const signature = hook.secret
        ? 'sha256=' + crypto.createHmac('sha256', hook.secret).update(body).digest('hex')
        : undefined

      // Fire-and-forget
      try {
        const res = await fetch(hook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Aavanam-Event': event,
            ...(signature ? { 'X-Aavanam-Signature': signature } : {}),
          },
          body,
          signal: AbortSignal.timeout(10000),  // 10s timeout per webhook
        })
        await db.webhook.update({
          where: { id: hook.id },
          data: { lastTriggeredAt: new Date(), lastResponseCode: res.status },
        })
      } catch (e) {
        // Update with 0 / null to indicate network failure
        await db.webhook.update({
          where: { id: hook.id },
          data: { lastTriggeredAt: new Date(), lastResponseCode: 0 },
        })
        console.error(`[webhook] failed to deliver to ${hook.url}:`, e)
      }
    }
  } catch (e) {
    console.error('[webhook] error in fireWebhooksForJob:', e)
  }
}
