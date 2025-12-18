import { createError } from 'h3'
import { assertIntegrationManager, getOrganizationIntegration } from '~~/server/services/integration'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)
  const db = getDB()

  await assertIntegrationManager(db, user.id, organizationId)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Integration ID is required'
    })
  }

  const integration = await getOrganizationIntegration(db, organizationId, id)

  if (!integration) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Integration not found'
    })
  }

  return integration
})
