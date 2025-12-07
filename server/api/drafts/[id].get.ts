import { createError, getQuery, getRouterParams } from 'h3'
import { getWorkspaceWithCache } from '~~/server/services/content/workspaceCache'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { validateUUID } from '~~/server/utils/validation'

async function findWorkspaceForActiveOrganization(
  db: ReturnType<typeof getDB>,
  activeOrganizationId: string,
  contentId: string,
  includeChat: boolean
) {
  try {
    return await getWorkspaceWithCache(db, activeOrganizationId, contentId, { includeChat })
  } catch (error: any) {
    if (error?.statusCode === 404) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Content not found'
      })
    }
    throw error
  }
}

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = getDB()

  const { id } = getRouterParams(event)
  const validatedContentId = validateUUID(id, 'id')
  const query = getQuery(event)
  const includeChatParam = Array.isArray(query.includeChat) ? query.includeChat[0] : query.includeChat
  const includeChat = includeChatParam === 'true' || includeChatParam === '1'

  const workspace = await findWorkspaceForActiveOrganization(db, organizationId, validatedContentId, includeChat)

  return {
    workspace
  }
})
