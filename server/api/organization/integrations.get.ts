import { getQuery } from 'h3'
import {
  assertIntegrationManager,
  listOrganizationIntegrationsWithAccounts,
  syncOrganizationOAuthIntegrations
} from '~~/server/services/integration'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'

/**
 * GET /api/organization/integrations
 *
 * Returns the list of integrations for the active organization.
 *
 * Sync Behavior:
 * - By default this endpoint returns the latest cached integrations immediately.
 * - Use the `force_sync=true` query parameter to explicitly run the OAuth sync.
 *   This should be done sparingly (e.g. right after a user links an account)
 *   because the sync performs heavier database work.
 *
 * Query Parameters:
 * - `force_sync` (optional): Set to "true" to force a sync. If omitted the
 *   endpoint simply returns cached integration records.
 *
 * Response Format:
 * {
 *   data: Integration[],           // Array of integration objects
 *   syncStatus: 'cached' | 'synced' | 'skipped',  // Sync operation status
 *   lastSyncedAt: string | null    // ISO timestamp of last sync, or null if never synced
 * }
 *
 * Sync Status Values:
 * - 'cached': Cached data returned (a previous sync was completed)
 * - 'synced': Sync was performed for this request (force_sync=true)
 * - 'skipped': No sync has run yet for this org
 *
 * Authentication:
 * - Requires authenticated user
 * - Requires active organization
 * - Requires organization owner or admin role
 */

// Track the last time a sync successfully ran per organization.
// This avoids re-running the heavy OAuth sync unless explicitly requested.
const lastSyncCache = new Map<string, number>()

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)
  const db = getDB()

  await assertIntegrationManager(db, user.id, organizationId)

  const query = getQuery(event)
  const forceSync = query.force_sync === 'true' || query.force_sync === true
  const lastSyncTime = lastSyncCache.get(organizationId) ?? null

  let syncStatus: 'cached' | 'synced' | 'skipped' = lastSyncTime ? 'cached' : 'skipped'
  let newLastSyncTime = lastSyncTime

  if (forceSync) {
    await syncOrganizationOAuthIntegrations(db, organizationId)
    newLastSyncTime = Date.now()
    lastSyncCache.set(organizationId, newLastSyncTime)
    syncStatus = 'synced'
  }

  const integrations = await listOrganizationIntegrationsWithAccounts(db, organizationId)

  // Return data with sync status metadata
  // The 'data' field contains the integrations array for backward compatibility
  return {
    data: integrations,
    syncStatus,
    lastSyncedAt: newLastSyncTime ? new Date(newLastSyncTime).toISOString() : null
  }
})
