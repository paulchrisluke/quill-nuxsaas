import { and, eq } from 'drizzle-orm'
import { createError, getRouterParams, readBody } from 'h3'
import * as schema from '~~/server/db/schema'
import { invalidateWorkspaceCache } from '~~/server/services/content/workspaceCache'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { validateUUID } from '~~/server/utils/validation'

interface RevertRequestBody {
  versionId?: string
}

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)
  const db = await useDB(event)

  const { id } = getRouterParams(event)
  const contentId = validateUUID(id, 'id')
  const body = await readBody<RevertRequestBody>(event)

  if (!body?.versionId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'versionId is required'
    })
  }

  const versionId = validateUUID(body.versionId, 'versionId')

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

  const [version] = await db
    .select({
      id: schema.contentVersion.id,
      contentId: schema.contentVersion.contentId
    })
    .from(schema.contentVersion)
    .where(and(
      eq(schema.contentVersion.id, versionId),
      eq(schema.contentVersion.contentId, contentId)
    ))
    .limit(1)

  if (!version) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Version not found for this content'
    })
  }

  const [updatedContent] = await db
    .update(schema.content)
    .set({
      currentVersionId: versionId,
      updatedAt: new Date()
    })
    .where(and(
      eq(schema.content.id, contentId),
      eq(schema.content.organizationId, organizationId)
    ))
    .returning({
      id: schema.content.id,
      currentVersionId: schema.content.currentVersionId
    })

  if (!updatedContent) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to revert content'
    })
  }

  invalidateWorkspaceCache(organizationId, contentId)

  return {
    contentId,
    versionId: updatedContent.currentVersionId
  }
})
