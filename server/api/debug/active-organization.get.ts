import { and, eq, sql } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { getAuthSession } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event)
  const activeOrganizationId = session?.session?.activeOrganizationId
    ?? session?.data?.session?.activeOrganizationId
    ?? session?.activeOrganizationId
    ?? null
  const userId = session?.user?.id ?? null

  const db = getDB()

  const [organization] = activeOrganizationId
    ? await db
        .select({
          id: schema.organization.id,
          name: schema.organization.name,
          slug: schema.organization.slug,
          createdAt: schema.organization.createdAt,
          lastSyncedAt: schema.organization.lastSyncedAt
        })
        .from(schema.organization)
        .where(eq(schema.organization.id, activeOrganizationId))
        .limit(1)
    : [null]

  const [membership] = activeOrganizationId && userId
    ? await db
        .select({
          id: schema.member.id,
          role: schema.member.role,
          organizationId: schema.member.organizationId,
          userId: schema.member.userId,
          createdAt: schema.member.createdAt
        })
        .from(schema.member)
        .where(and(
          eq(schema.member.organizationId, activeOrganizationId),
          eq(schema.member.userId, userId)
        ))
        .limit(1)
    : [null]

  const [memberCountRow] = activeOrganizationId
    ? await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.member)
        .where(eq(schema.member.organizationId, activeOrganizationId))
        .limit(1)
    : [null]

  return {
    activeOrganizationId,
    userId,
    organization,
    membership,
    memberCount: memberCountRow ? Number(memberCountRow.count) || 0 : 0
  }
})
