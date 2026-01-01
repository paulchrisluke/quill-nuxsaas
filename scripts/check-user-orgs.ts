import { eq, inArray } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { getDB } from '../server/utils/db'
import 'dotenv/config'

async function checkOrgs() {
  const db = getDB()

  // Accept email from CLI argument or environment variable
  const email = process.argv[2] || process.env.CHECK_USER_EMAIL

  if (!email || email.trim() === '') {
    throw new Error('Email is required. Usage: tsx scripts/check-user-orgs.ts <email> or set CHECK_USER_EMAIL env var')
  }

  // Redact email for logging (show first 2 chars + domain)
  const atIndex = email.indexOf('@')
  const redactedEmail = atIndex > 2
    ? `${email.slice(0, 2)}***${email.slice(atIndex)}`
    : '***'
  console.log('Checking user:', redactedEmail)

  const users = await db.select().from(schema.user).where(eq(schema.user.email, email))
  if (users.length === 0) {
    console.log('User not found')
    return
  }

  const user = users[0]
  console.log('User found:', user.id ? '[REDACTED]' : 'no ID')
  console.log('Has active org:', user.lastActiveOrganizationId ? 'yes' : 'no')

  const members = await db.select().from(schema.member).where(eq(schema.member.userId, user.id))
  console.log('User is member of:', members.length, 'orgs')

  if (members.length === 0) {
    return
  }

  // Batch fetch all organizations to avoid N+1 query
  const orgIds = members.map(m => m.organizationId)
  const orgs = await db.select().from(schema.organization).where(inArray(schema.organization.id, orgIds))

  // Build map for O(1) lookup
  const orgMap = new Map(orgs.map(org => [org.id, org]))

  for (const member of members) {
    const org = orgMap.get(member.organizationId)
    if (org) {
      console.log(`- Org: ${org.name} (Slug: ${org.slug})`)
    } else {
      console.log(`- Member of unknown org (not found in database)`)
    }
  }
}

checkOrgs().catch(console.error)
