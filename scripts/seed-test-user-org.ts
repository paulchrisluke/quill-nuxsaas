#!/usr/bin/env tsx
import 'dotenv/config'

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
  throw new Error('DATABASE_URL is required to seed the primary database.')
}

const testEmail = process.env.NUXT_TEST_EMAIL
const testPassword = process.env.NUXT_TEST_PASSWORD
const organizationId = process.env.NUXT_TEST_ORGANIZATION_ID
const organizationSlug = process.env.NUXT_TEST_ORG_SLUG || 'personal-019b7825'

if (!testEmail || !testPassword) {
  throw new Error('NUXT_TEST_EMAIL and NUXT_TEST_PASSWORD must be set.')
}

const { and, eq } = await import('drizzle-orm')
const { v7: uuidv7 } = await import('uuid')
const { hashPassword } = await import('better-auth/crypto')
const { getDB } = await import('../server/utils/db')
const schema = await import('../server/db/schema')

const email = testEmail.toLowerCase().trim()
const db = getDB()

const ensureUser = async () => {
  const existing = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1)
  if (existing.length > 0) {
    return existing[0]!
  }

  const userId = uuidv7()
  const [created] = await db
    .insert(schema.user)
    .values({
      id: userId,
      name: email.split('@')[0] || 'Test User',
      email,
      emailVerified: true,
      isAnonymous: false
    })
    .returning()

  return created
}

const ensureCredentialAccount = async (userId: string) => {
  const existing = await db
    .select()
    .from(schema.account)
    .where(
      and(
        eq(schema.account.userId, userId),
        eq(schema.account.providerId, 'credential')
      )
    )
    .limit(1)

  if (existing.length > 0) {
    return existing[0]!
  }

  const passwordHash = await hashPassword(testPassword)
  const [created] = await db
    .insert(schema.account)
    .values({
      id: uuidv7(),
      accountId: email,
      providerId: 'credential',
      userId,
      password: passwordHash
    })
    .returning()

  return created
}

const ensureOrganization = async () => {
  if (organizationId) {
    const existing = await db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1)
    if (existing.length > 0) {
      return existing[0]!
    }
  }

  const existingBySlug = await db
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.slug, organizationSlug))
    .limit(1)
  if (existingBySlug.length > 0) {
    return existingBySlug[0]!
  }

  const orgId = organizationId || uuidv7()
  const [created] = await db
    .insert(schema.organization)
    .values({
      id: orgId,
      name: 'Test Organization',
      slug: organizationSlug,
      isAnonymous: false
    })
    .returning()

  return created
}

const ensureMember = async (userId: string, orgId: string) => {
  const existing = await db
    .select()
    .from(schema.member)
    .where(
      and(
        eq(schema.member.userId, userId),
        eq(schema.member.organizationId, orgId)
      )
    )
    .limit(1)

  if (existing.length > 0) {
    return existing[0]!
  }

  const [created] = await db
    .insert(schema.member)
    .values({
      id: uuidv7(),
      organizationId: orgId,
      userId,
      role: 'owner'
    })
    .returning()

  return created
}

const ensureActiveOrg = async (userId: string, orgId: string) => {
  await db
    .update(schema.user)
    .set({
      lastActiveOrganizationId: orgId,
      defaultOrganizationId: orgId
    })
    .where(eq(schema.user.id, userId))
}

const main = async () => {
  const user = await ensureUser()
  await ensureCredentialAccount(user.id)
  const org = await ensureOrganization()
  await ensureMember(user.id, org.id)
  await ensureActiveOrg(user.id, org.id)

  console.log('Seeded test user + org:')
  console.log(`- user: ${user.id}`)
  console.log(`- org: ${org.id}`)
  console.log(`- slug: ${org.slug}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
