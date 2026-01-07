import type { SQL } from 'drizzle-orm'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import { z } from 'zod'
import * as schema from '~~/server/db/schema'
import { requireAdmin } from '~~/server/utils/auth'

const paramsSchema = z.object({
  orgId: z.string().min(1)
})

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  includeMetadata: z
    .union([z.boolean(), z.string().transform(value => value === 'true')])
    .optional()
    .default(false)
})

interface CursorPayload {
  id: string
  updatedAt: string
}

const encodeCursor = (payload: CursorPayload) => {
  const base64 = btoa(JSON.stringify(payload))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

const decodeCursor = (cursor: string): CursorPayload => {
  try {
    const base64 = cursor.replace(/-/g, '+').replace(/_/g, '/')
    const paddingNeeded = (4 - (base64.length % 4 || 4)) % 4
    const padded = `${base64}${'='.repeat(paddingNeeded)}`
    const json = atob(padded)
    const parsed = JSON.parse(json) as CursorPayload
    if (!parsed?.id || !parsed?.updatedAt)
      throw new Error('Invalid cursor payload')
    return parsed
  } catch (error) {
    console.error('[admin/chats] Failed to decode cursor', error)
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Invalid cursor value'
    })
  }
}

export default defineEventHandler(async (event) => {
  // Ensure only admins can inspect organization conversations
  await requireAdmin(event)
  const { orgId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const query = await getValidatedQuery(event, querySchema.parse)
  const db = await useDB(event)

  const [org] = await db
    .select({ id: schema.organization.id, name: schema.organization.name, slug: schema.organization.slug })
    .from(schema.organization)
    .where(eq(schema.organization.id, orgId))
    .limit(1)

  if (!org) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: 'Organization not found'
    })
  }

  let cursorDate: Date | null = null
  let cursorId: string | null = null
  if (query.cursor) {
    const decoded = decodeCursor(query.cursor)
    cursorId = decoded.id
    const parsedDate = new Date(decoded.updatedAt)
    if (Number.isNaN(parsedDate.getTime())) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'Invalid cursor timestamp'
      })
    }
    cursorDate = parsedDate
  }

  const selectFields: Record<string, any> = {
    id: schema.conversation.id,
    organizationId: schema.conversation.organizationId,
    status: schema.conversation.status,
    sourceContentId: schema.conversation.sourceContentId,
    createdByUserId: schema.conversation.createdByUserId,
    createdAt: schema.conversation.createdAt,
    updatedAt: schema.conversation.updatedAt
  }

  if (query.includeMetadata) {
    selectFields.metadata = schema.conversation.metadata
  }

  const filters: SQL<unknown>[] = [eq(schema.conversation.organizationId, orgId)]

  if (cursorDate && cursorId) {
    const cursorFilter = or(
      lt(schema.conversation.updatedAt, cursorDate),
      and(
        eq(schema.conversation.updatedAt, cursorDate),
        lt(schema.conversation.id, cursorId)
      )
    )
    if (cursorFilter) {
      filters.push(cursorFilter)
    }
  }

  const whereClause = filters.length === 1 ? filters[0]! : and(...filters)

  const results = await db
    .select(selectFields)
    .from(schema.conversation)
    .where(whereClause)
    .orderBy(desc(schema.conversation.updatedAt), desc(schema.conversation.id))
    .limit(query.limit + 1)

  const hasMore = results.length > query.limit
  const conversations = hasMore ? results.slice(0, query.limit) : results

  let nextCursor: string | null = null
  if (hasMore && conversations.length > 0) {
    const last = conversations[conversations.length - 1]!
    const updatedAt = last.updatedAt instanceof Date
      ? last.updatedAt.toISOString()
      : new Date(last.updatedAt).toISOString()
    nextCursor = encodeCursor({
      id: last.id,
      updatedAt
    })
  }

  return {
    org,
    conversations,
    nextCursor,
    hasMore,
    limit: query.limit
  }
})
