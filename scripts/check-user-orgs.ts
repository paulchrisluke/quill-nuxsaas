import { eq } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { getDB } from '../server/utils/db'
import 'dotenv/config'

async function checkOrgs() {
  const db = getDB()
  const email = 'paulchrisluke@yahoo.com'

  console.log('Checking user:', email)

  const users = await db.select().from(schema.user).where(eq(schema.user.email, email))
  if (users.length === 0) {
    console.log('User not found')
    return
  }

  const user = users[0]
  console.log('User ID:', user.id)
  console.log('Last Active Org ID:', user.lastActiveOrganizationId)

  const members = await db.select().from(schema.member).where(eq(schema.member.userId, user.id))
  console.log('User is member of:', members.length, 'orgs')

  for (const member of members) {
    const orgs = await db.select().from(schema.organization).where(eq(schema.organization.id, member.organizationId))
    if (orgs.length > 0) {
      console.log(`- Org: ${orgs[0].name} (ID: ${orgs[0].id}, Slug: ${orgs[0].slug})`)
    } else {
      console.log(`- Member of unknown org ID: ${member.organizationId}`)
    }
  }
}

checkOrgs().catch(console.error)
