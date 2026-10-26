/**
 * Auto-seed helper — runs on first request if DB is empty.
 *
 * The Z.ai sandbox periodically wipes the home directory (and the SQLite DB
 * along with it). To make the app self-healing, this helper checks on every
 * server boot whether the User table is empty and, if so, runs the bundled
 * seed script.
 *
 * Triggered from lib/db.ts when the Prisma client is first instantiated.
 */

import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { BUNDLED_TEMPLATES, serializeTemplateFields } from '@/lib/templates/schema'

let seedRan = false

export async function ensureSeeded(): Promise<void> {
  if (seedRan) return
  seedRan = true
  try {
    const userCount = await db.user.count()
    if (userCount > 0) {
      return  // already seeded
    }
    console.log('[seed] DB is empty — auto-seeding default org + user + templates...')

    const DEFAULT_EMAIL = 'admin@aavanam.local'
    const DEFAULT_PASSWORD = 'aavanam123'

    // Create default org
    const org = await db.organization.create({
      data: { name: 'Aavanam (default)', status: 'active' },
    })

    // Create default user
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10)
    const user = await db.user.create({
      data: { email: DEFAULT_EMAIL, passwordHash, name: 'Aavanam Admin', status: 'active' },
    })

    // Make user admin of org
    await db.organizationMember.create({
      data: { organizationId: org.id, userId: user.id, role: 'admin' },
    })

    // Seed bundled templates
    for (const tpl of BUNDLED_TEMPLATES) {
      await db.template.create({
        data: {
          organizationId: org.id,
          name: tpl.name,
          documentType: tpl.documentType,
          fieldsJson: serializeTemplateFields(tpl.fields),
          instructions: tpl.instructions,
        },
      })
    }

    console.log('[seed] ✓ Complete. Login: admin@aavanam.local / aavanam123')
  } catch (e) {
    console.error('[seed] failed:', e)
    seedRan = false  // allow retry on next request
  }
}
