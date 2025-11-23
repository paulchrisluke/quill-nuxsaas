import { eq, and, count } from 'drizzle-orm'
import { member } from '../../database/schema'
import { getDB } from '../../utils/db'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const userId = user.id
  
  const db = getDB()
  // Count members where userId is me and role is owner
  const result = await db.select({ count: count() })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.role, 'owner')))
    
  return { count: result[0].count }
})
