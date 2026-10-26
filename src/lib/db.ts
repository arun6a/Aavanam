import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

// Auto-seed on first DB instantiation — runs in background, never blocks.
// Per Z.ai sandbox: home dir gets wiped periodically, which empties the
// SQLite DB. This re-creates the default org + admin user + bundled
// templates on first request after a wipe. Idempotent — only seeds when
// DB has zero users.
import('@/lib/auto-seed').then(({ ensureSeeded }) => ensureSeeded()).catch((e) => {
  console.error('[db] auto-seed failed to load:', e)
})