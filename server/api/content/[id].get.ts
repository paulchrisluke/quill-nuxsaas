import { getRouterParams } from 'h3'
import { getContentWorkspacePayload } from '~~/server/services/content/workspace'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = getDB()

  const { id } = getRouterParams(event)

  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A valid content id is required'
    })
  }

  return await getContentWorkspacePayload(db, organizationId, id)
})
