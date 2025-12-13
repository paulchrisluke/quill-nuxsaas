import { desc } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '~~/server/db/schema'
import { requireAdmin } from '~~/server/utils/auth'

export default defineEventHandler(async (event) => {
  // Ensure user is authenticated and authorized for admin resources
  await requireAdmin(event)
  const db = await useDB(event)

  try {
    const orgs = await db
      .select({
        id: schema.organization.id,
        name: schema.organization.name,
        slug: schema.organization.slug,
        createdAt: schema.organization.createdAt
      })
      .from(schema.organization)
      .orderBy(desc(schema.organization.createdAt))
      .limit(200)

    return { orgs }
  } catch (error) {
    console.error('[admin/chats/orgs.get] Failed to fetch organizations:', error)
    throw createError({
      statusCode: 500,
      message: 'Failed to fetch organizations'
    })
  }
})
