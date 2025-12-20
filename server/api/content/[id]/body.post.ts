import type { UpdateContentBodyRequestBody } from '~~/server/types/content'
import { getRouterParams, readBody } from 'h3'
import { updateContentBodyManual } from '~~/server/services/content/generation'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { validateRequestBody, validateRequiredString, validateUUID } from '~~/server/utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)
  const db = await useDB(event)

  const { id } = getRouterParams(event)
  const contentId = validateUUID(id, 'contentId')

  const body = await readBody<UpdateContentBodyRequestBody>(event)
  validateRequestBody(body)

  const markdown = validateRequiredString(body.markdown, 'markdown')

  const result = await updateContentBodyManual(db, {
    organizationId,
    userId: user.id,
    contentId,
    markdown
  })

  return {
    content: result.content,
    version: result.version,
    markdown: result.markdown
  }
})
