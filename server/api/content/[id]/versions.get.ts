import { and, desc, eq, sql } from 'drizzle-orm'
import { createError, getRouterParams } from 'h3'
import * as schema from '~~/server/db/schema'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { validateUUID } from '~~/server/utils/validation'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)
  const db = await useDB(event)

  const { id } = getRouterParams(event)
  const contentId = validateUUID(id, 'id')

  const [content] = await db
    .select({
      id: schema.content.id,
      currentVersionId: schema.content.currentVersionId
    })
    .from(schema.content)
    .where(and(
      eq(schema.content.id, contentId),
      eq(schema.content.organizationId, organizationId)
    ))
    .limit(1)

  if (!content) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content not found'
    })
  }

  const versions = await db
    .select({
      id: schema.contentVersion.id,
      version: schema.contentVersion.version,
      createdAt: schema.contentVersion.createdAt,
      createdByUserId: schema.contentVersion.createdByUserId,
      title: sql<string | null>`${schema.contentVersion.frontmatter}->>'title'`,
      diffStats: sql<{ additions?: number, deletions?: number } | null>`${schema.contentVersion.frontmatter}->'diffStats'`
    })
    .from(schema.contentVersion)
    .where(eq(schema.contentVersion.contentId, contentId))
    .orderBy(desc(schema.contentVersion.version))
    .limit(50)

  return {
    contentId: content.id,
    currentVersionId: content.currentVersionId,
    versions: versions.map(entry => ({
      id: entry.id,
      version: entry.version,
      createdAt: entry.createdAt instanceof Date ? entry.createdAt.toISOString() : entry.createdAt,
      createdByUserId: entry.createdByUserId,
      title: entry.title,
      diffStats: entry.diffStats
        ? {
            additions: entry.diffStats.additions != null ? Number(entry.diffStats.additions) || 0 : null,
            deletions: entry.diffStats.deletions != null ? Number(entry.diffStats.deletions) || 0 : null
          }
        : null
    }))
  }
})
