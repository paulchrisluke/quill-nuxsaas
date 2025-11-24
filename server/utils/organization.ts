import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import * as schema from '../database/schema'
import { getDB } from './db'

interface RequireActiveOrganizationOptions {
  requireRoles?: Array<'owner' | 'admin' | 'member'>
}

export const requireActiveOrganization = async (
  event: H3Event,
  userId: string,
  options?: RequireActiveOrganizationOptions
) => {
  const db = getDB()

  const [dbUser] = await db
    .select({
      id: schema.user.id,
      lastActiveOrganizationId: schema.user.lastActiveOrganizationId
    })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1)

  const organizationId = dbUser?.lastActiveOrganizationId

  if (!organizationId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No active organization found in session'
    })
  }

  const [membership] = await db
    .select()
    .from(schema.member)
    .where(and(
      eq(schema.member.userId, userId),
      eq(schema.member.organizationId, organizationId)
    ))
    .limit(1)

  if (!membership) {
    throw createError({
      statusCode: 403,
      statusMessage: 'You do not have access to this organization'
    })
  }

  if (options?.requireRoles && options.requireRoles.length > 0) {
    if (!options.requireRoles.includes(membership.role as any)) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Insufficient permissions for this organization'
      })
    }
  }

  return { organizationId, membership }
}
