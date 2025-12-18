import { createError } from 'h3'
import { assertIntegrationManager, deleteOrganizationIntegration } from '~~/server/services/integration'
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

  const db = getDB()
  await assertIntegrationManager(db, user.id, organizationId)

  const deleted = await deleteOrganizationIntegration(db, organizationId, id)

  if (!deleted) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Integration not found'
    })
  }

  return { success: true }
})
