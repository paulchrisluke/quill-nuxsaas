import { and, eq, sql } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '~~/server/db/schema'
import { logAuditEvent } from '~~/server/utils/auditLogger'
import { getAuthSession, requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production') {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found'
    })
  }

  const user = await requireAuth(event)
  const session = await getAuthSession(event)
  const activeOrganizationId = session?.session?.activeOrganizationId
    ?? session?.data?.session?.activeOrganizationId
    ?? session?.activeOrganizationId
    ?? null
  const userId = session?.user?.id ?? null

  const db = getDB()

  const [accessMembership] = activeOrganizationId && userId
    ? await db
        .select({ role: schema.member.role })
        .from(schema.member)
        .where(and(
          eq(schema.member.organizationId, activeOrganizationId),
          eq(schema.member.userId, userId)
        ))
        .limit(1)
    : [null]

  const hasDebugAccess = user.role === 'admin'
    || accessMembership?.role === 'owner'
    || accessMembership?.role === 'admin'

  if (!hasDebugAccess) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden'
    })
  }

  await logAuditEvent({
    userId: user.id,
    category: 'debug',
    action: 'active_organization_read',
    targetType: 'organization',
    targetId: activeOrganizationId ?? undefined,
    ipAddress: event.node.req.headers['x-forwarded-for']?.toString(),
    userAgent: event.node.req.headers['user-agent']?.toString(),
    status: 'success'
  })

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
