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
    console.warn('[integrations] Update validation failed', {
      organizationId,
      integrationId: id,
      userId: user.id,
      issues: parsed.error.flatten()
    })
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: parsed.error.flatten()
    })
  }

  const db = getDB()
  await assertIntegrationManager(db, user.id, organizationId)

  console.log('[integrations] Update request', {
    organizationId,
    integrationId: id,
    userId: user.id,
    hasConfig: Boolean(parsed.data?.config),
    configKeys: parsed.data?.config && typeof parsed.data.config === 'object'
      ? Object.keys(parsed.data.config)
      : []
  })

  let integration
  try {
    integration = await updateOrganizationIntegration(db, organizationId, id, parsed.data)
  } catch (error) {
    console.error('[integrations] Update failed', {
      organizationId,
      integrationId: id,
      userId: user.id,
      error
    })
    throw error
  }

  if (!integration) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Integration not found'
    })
  }

  return integration
})
