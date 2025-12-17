import {
  assertIntegrationManager,
  listOrganizationIntegrationsWithAccounts,
  syncOrganizationOAuthIntegrations
} from '~~/server/services/integration'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)
  const db = getDB()

  await assertIntegrationManager(db, user.id, organizationId)

  await syncOrganizationOAuthIntegrations(db, organizationId)

  return listOrganizationIntegrationsWithAccounts(db, organizationId)
})
