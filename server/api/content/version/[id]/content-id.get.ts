import { and, eq } from 'drizzle-orm'
import { createError, getRouterParams } from 'h3'
import * as schema from '~~/server/db/schema'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { validateUUID } from '~~/server/utils/validation'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)
  const db = getDB()

  const { id } = getRouterParams(event)
  const versionId = validateUUID(id, 'id')

  const [version] = await db
    .select({
      contentId: schema.contentVersion.contentId
    })
    .from(schema.contentVersion)
    .where(eq(schema.contentVersion.id, versionId))
    .limit(1)

  if (!version) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Version not found'
    })
  }

  // Verify the content belongs to the organization
  const [content] = await db
    .select({
      id: schema.content.id
    })
    .from(schema.content)
    .where(and(
      eq(schema.content.id, version.contentId),
      eq(schema.content.organizationId, organizationId)
    ))
    .limit(1)

  if (!content) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content not found'
    })
  }

  return {
    contentId: version.contentId
  }
})
