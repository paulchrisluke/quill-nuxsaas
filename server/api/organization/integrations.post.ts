import { createError } from 'h3'
import { assertIntegrationManager, createOrganizationIntegration } from '~~/server/services/integration'
import { createIntegrationSchema } from '~~/server/types/integration'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)
  const body = await readBody(event)
  const parsed = createIntegrationSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: parsed.error.flatten()
    })
  }

  const db = getDB()
  await assertIntegrationManager(db, user.id, organizationId)

  return createOrganizationIntegration(db, organizationId, parsed.data)
})
