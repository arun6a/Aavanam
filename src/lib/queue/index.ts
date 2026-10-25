/**
 * Async job queue — in-memory (Phase 2 MVP).
 *
 * The processing worker is in `worker.ts`. The queue is just an in-memory array
 * of pending job IDs. When deployed to GCP (Phase 6), swap this for Cloud Tasks
 * — the worker's processJob() function stays exactly the same.
 *
 * Why in-memory for MVP:
 *   - No infrastructure needed for dev
 *   - Persists across requests within the same Node process
 *   - Doesn't survive server restarts (acceptable for dev — DB job records show as
 *     "processing" forever; would clean up via background sweep in production)
 *
 * Limits:
 *   - Single Node process — no horizontal scaling
 *   - No retry queue (job just fails if processing throws)
 *   - Job state lives in DB; queue only tracks which IDs to process next
 */

import { processJob } from './worker'

const pendingJobIds: string[] = []
let workerRunning = false

export function enqueueJob(jobId: string): void {
  pendingJobIds.push(jobId)
  startWorker()
}

async function startWorker(): Promise<void> {
  if (workerRunning) return
  workerRunning = true
  try {
    while (pendingJobIds.length > 0) {
      const jobId = pendingJobIds.shift()!
      try {
        await processJob(jobId)
      } catch (e) {
        console.error(`[queue] job ${jobId} failed:`, e)
      }
    }
  } finally {
    workerRunning = false
  }
}

/** Inspect queue state — for dashboard/debugging. */
export function getQueueLength(): number {
  return pendingJobIds.length
}
