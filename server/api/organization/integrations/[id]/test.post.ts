import { createError } from 'h3'
import { assertIntegrationManager, testOrganizationIntegration } from '~~/server/services/integration'
import { testIntegrationSchema } from '~~/server/types/integration'
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
  const parsed = testIntegrationSchema.safeParse(body ?? {})

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: parsed.error.flatten()
    })
  }

  const db = getDB()
  await assertIntegrationManager(db, user.id, organizationId)

  return testOrganizationIntegration(db, organizationId, id, parsed.data)
})
