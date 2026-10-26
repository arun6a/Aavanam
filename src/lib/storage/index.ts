/**
 * Google Cloud Storage adapter — implements the same storage interface
 * as the local /tmp storage used in dev.
 *
 * When deployed to GCP, set STORAGE_PROVIDER=gcs in .env and configure
 * the bucket names. The worker will use this adapter instead of writing
 * to /tmp.
 *
 * For local dev: STORAGE_PROVIDER is unset → falls back to local fs.
 * The worker (lib/queue/worker.ts) calls storage.write() / storage.read()
 * instead of fs.writeFile() / fs.readFile() directly.
 *
 * To enable in production:
 *   1. Install: bun add @google-cloud/storage
 *   2. Create GCS buckets: gs://aavanam-originals, gs://aavanam-exports
 *   3. Set env vars:
 *        STORAGE_PROVIDER=gcs
 *        GCS_BUCKET_ORIGINALS=aavanam-originals
 *        GCS_BUCKET_EXPORTS=aavanam-exports
 *   4. Service account credentials via GOOGLE_APPLICATION_CREDENTIALS
 *      (Cloud Run sets this automatically when you bind a service account)
 */

import fs from 'fs/promises'
import path from 'path'

export interface StorageAdapter {
  write(key: string, data: Buffer): Promise<void>
  read(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
}

// ─── Local filesystem adapter (default for dev) ────────────────────────────

const LOCAL_DIR = '/tmp/aavanam-uploads'

class LocalStorage implements StorageAdapter {
  async write(key: string, data: Buffer): Promise<void> {
    const fullPath = path.join(LOCAL_DIR, key)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, data)
  }
  async read(key: string): Promise<Buffer> {
    return fs.readFile(path.join(LOCAL_DIR, key))
  }
  async delete(key: string): Promise<void> {
    try { await fs.unlink(path.join(LOCAL_DIR, key)) } catch {}
  }
}

// ─── GCS adapter (production) ──────────────────────────────────────────────
//
// To enable: uncomment this + install @google-cloud/storage
// import { Storage } from '@google-cloud/storage'
//
// class GcsStorage implements StorageAdapter {
//   private bucket: string
//   constructor(bucket: string) { this.bucket = bucket }
//   async write(key: string, data: Buffer): Promise<void> {
//     const storage = new Storage()
//     await storage.bucket(this.bucket).file(key).save(data)
//   }
//   async read(key: string): Promise<Buffer> {
//     const storage = new Storage()
//     const [buffer] = await storage.bucket(this.bucket).file(key).download()
//     return buffer
//   }
//   async delete(key: string): Promise<void> {
//     const storage = new Storage()
//     await storage.bucket(this.bucket).file(key).delete({ ignoreNotFound: true })
//   }
// }

// ─── Factory ───────────────────────────────────────────────────────────────

let _instance: StorageAdapter | null = null

export function getStorage(): StorageAdapter {
  if (_instance) return _instance
  const provider = process.env.STORAGE_PROVIDER ?? 'local'
  if (provider === 'gcs') {
    // Production GCS path (uncomment when @google-cloud/storage is installed)
    // const bucket = process.env.GCS_BUCKET_ORIGINALS ?? 'aavanam-originals'
    // _instance = new GcsStorage(bucket)
    // For now, fall back to local until @google-cloud/storage is installed:
    console.warn('[storage] GCS requested but @google-cloud/storage not installed — falling back to local')
    _instance = new LocalStorage()
  } else {
    _instance = new LocalStorage()
  }
  return _instance
}
