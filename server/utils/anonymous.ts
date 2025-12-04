import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { User } from '~~/shared/utils/types'
import { count, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { ANONYMOUS_DRAFT_LIMIT } from '~~/shared/constants/limits'
import * as schema from '../database/schema'

export interface AnonymousDraftUsage {
  limit: number
  used: number
  remaining: number
}

type MinimalUser = Pick<User, 'id' | 'isAnonymous'>

export const getAnonymousDraftUsage = async (db: NodePgDatabase<typeof schema>, organizationId: string): Promise<AnonymousDraftUsage> => {
  const [{ total }] = await db
    .select({ total: count() })
    .from(schema.content)
    .where(eq(schema.content.organizationId, organizationId))

  const used = Number(total) || 0
  return {
    limit: ANONYMOUS_DRAFT_LIMIT,
    used,
    remaining: Math.max(0, ANONYMOUS_DRAFT_LIMIT - used)
  }
}

export const ensureAnonymousDraftCapacity = async (
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  userOrId: MinimalUser | string
): Promise<AnonymousDraftUsage | null> => {
  let user: MinimalUser | null = typeof userOrId === 'string'
    ? null
    : userOrId

  if (!user) {
    const [row] = await db
      .select({
        id: schema.user.id,
        isAnonymous: schema.user.isAnonymous
      })
      .from(schema.user)
      .where(eq(schema.user.id, userOrId as string))
      .limit(1)

    if (!row)
      return null
    user = row
  }

  if (!user?.isAnonymous) {
    return null
  }

  const usage = await getAnonymousDraftUsage(db, organizationId)

  if (usage.used >= usage.limit) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Anonymous draft limit reached. Please sign up or log in to keep drafting.'
    })
  }

  return usage
}
