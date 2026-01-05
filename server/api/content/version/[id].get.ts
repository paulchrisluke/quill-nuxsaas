import { and, eq } from 'drizzle-orm'
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
  const versionId = validateUUID(id, 'id')

  const [version] = await db
    .select({
      id: schema.contentVersion.id,
      contentId: schema.contentVersion.contentId,
      bodyMarkdown: schema.contentVersion.bodyMarkdown,
      sections: schema.contentVersion.sections,
      frontmatter: schema.contentVersion.frontmatter
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

  const [content] = await db
    .select({
      id: schema.content.id,
      organizationId: schema.content.organizationId
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
    id: version.id,
    contentId: version.contentId,
    bodyMarkdown: version.bodyMarkdown ?? '',
    sections: version.sections ?? null,
    frontmatter: version.frontmatter ?? null
  }
})
