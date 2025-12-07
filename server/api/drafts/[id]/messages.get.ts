import { createError, getRouterParams } from 'h3'
import { findChatSession, getSessionMessages } from '~~/server/services/chatSession'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { validateUUID } from '~~/server/utils/validation'

async function resolveSession(
  db: ReturnType<typeof getDB>,
  activeOrganizationId: string,
  contentId: string
) {
  const session = await findChatSession(db, activeOrganizationId, contentId)
  if (session) {
    return { session, organizationId: activeOrganizationId }
  }

  throw createError({
    statusCode: 404,
    statusMessage: 'Chat session not found'
  })
}

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = getDB()

  const { id } = getRouterParams(event)
  const validatedContentId = validateUUID(id, 'id')

  let resolvedSession
  try {
    resolvedSession = await resolveSession(db, organizationId, validatedContentId)
  } catch (error: any) {
    if (error?.statusCode === 404) {
      return { messages: [] }
    }
    throw error
  }

  const messages = await getSessionMessages(db, resolvedSession.session.id, resolvedSession.organizationId)

  return {
    messages: messages.map(message => ({
      id: message.id,
      role: message.role,
      content: message.content,
      payload: message.payload,
      createdAt: message.createdAt
    }))
  }
})
