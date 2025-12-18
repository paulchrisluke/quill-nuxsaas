import { createError } from 'h3'
import { assertIntegrationManager, updateOrganizationIntegration } from '~~/server/services/integration'
import { updateIntegrationSchema } from '~~/server/types/integration'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Integration ID is required'
    })
  }

  const body = await readBody(event)
  const parsed = updateIntegrationSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: parsed.error.flatten()
    })
  }

  const db = getDB()
  await assertIntegrationManager(db, user.id, organizationId)

  const integration = await updateOrganizationIntegration(db, organizationId, id, parsed.data)

  if (!integration) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Integration not found'
    })
  }

  return integration
})
