/**
 * Seed default Organization + User + bundled templates.
 *
 * Run after schema push to set up a fresh install.
 * Idempotent — safe to run multiple times.
 */

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { BUNDLED_TEMPLATES, serializeTemplateFields } from '../src/lib/templates/schema'

const db = new PrismaClient()

async function main() {
  console.log('Seeding Aavanam default org + user + bundled templates...')

  const DEFAULT_EMAIL = 'admin@aavanam.local'
  const DEFAULT_PASSWORD = 'aavanam123'

  // 1. Create default org
  let org = await db.organization.findFirst({ where: { name: 'Aavanam (default)' } })
  if (!org) {
    org = await db.organization.create({
      data: { name: 'Aavanam (default)', status: 'active' },
    })
    console.log(`  Created default org: ${org.id}`)
  } else {
    console.log(`  Default org already exists: ${org.id}`)
  }

  // 2. Create default user
  let user = await db.user.findUnique({ where: { email: DEFAULT_EMAIL } })
  if (!user) {
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10)
    user = await db.user.create({
      data: { email: DEFAULT_EMAIL, passwordHash, name: 'Aavanam Admin', status: 'active' },
    })
    console.log(`  Created default user: ${user.id} (${DEFAULT_EMAIL})`)
  } else {
    console.log(`  Default user already exists: ${user.id}`)
  }

  // 3. Make user admin of default org
  const existingMembership = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
  })
  if (!existingMembership) {
    await db.organizationMember.create({
      data: { organizationId: org.id, userId: user.id, role: 'admin' },
    })
    console.log('  User is now admin of default org')
  }

  // 4. Seed bundled templates for the default org
  const existingTplCount = await db.template.count({ where: { organizationId: org.id } })
  if (existingTplCount === 0) {
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
      console.log(`  Seeded template: ${tpl.name}`)
    }
  } else {
    console.log(`  Templates already seeded (${existingTplCount})`)
  }

  console.log('\n✓ Seed complete.')
  console.log('\nDefault login credentials:')
  console.log(`  Email: ${DEFAULT_EMAIL}`)
  console.log(`  Password: ${DEFAULT_PASSWORD}`)
}

main()
  .catch(e => { console.error('Seed failed:', e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
