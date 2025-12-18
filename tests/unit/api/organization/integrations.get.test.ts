import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetQuery = vi.fn()
const mockRequireAuth = vi.fn()
const mockRequireActiveOrganization = vi.fn()
const mockAssertIntegrationManager = vi.fn()
const mockListIntegrationsWithAccounts = vi.fn()
const mockSyncOrganizationOAuthIntegrations = vi.fn()
const mockGetDB = vi.fn()

vi.mock('h3', () => ({
  getQuery: (event: any) => mockGetQuery(event),
  defineEventHandler: (handler: any) => handler
}))

vi.mock('~~/server/utils/auth', () => ({
  requireAuth: (event: any) => mockRequireAuth(event),
  requireActiveOrganization: (event: any) => mockRequireActiveOrganization(event)
}))

vi.mock('~~/server/utils/db', () => ({
  getDB: () => mockGetDB()
}))

vi.mock('~~/server/services/integration', () => ({
  assertIntegrationManager: (...args: any[]) => mockAssertIntegrationManager(...args),
  listOrganizationIntegrationsWithAccounts: (...args: any[]) => mockListIntegrationsWithAccounts(...args),
  syncOrganizationOAuthIntegrations: (...args: any[]) => mockSyncOrganizationOAuthIntegrations(...args)
}))

const importHandler = async () => {
  const module = await import('~~/server/api/organization/integrations.get')
  return module.default
}

describe('get /api/organization/integrations', () => {
  beforeEach(() => {
    vi.resetModules()
    mockGetQuery.mockReset()
    mockRequireAuth.mockReset()
    mockRequireActiveOrganization.mockReset()
    mockAssertIntegrationManager.mockReset()
    mockListIntegrationsWithAccounts.mockReset()
    mockSyncOrganizationOAuthIntegrations.mockReset()
    mockGetDB.mockReset()

    mockRequireAuth.mockResolvedValue({ id: 'user_1' })
    mockRequireActiveOrganization.mockResolvedValue({ organizationId: 'org_1' })
    mockAssertIntegrationManager.mockResolvedValue(undefined)
    mockListIntegrationsWithAccounts.mockResolvedValue([{ id: 'int_1' }])
    mockSyncOrganizationOAuthIntegrations.mockResolvedValue(undefined)
    mockGetDB.mockReturnValue({ db: true })
  })

  it('returns cached integrations without syncing when force_sync is absent', async () => {
    mockGetQuery.mockReturnValue({})
    const handler = await importHandler()
    const response = await handler({} as any)

    expect(response.syncStatus).toBe('skipped')
    expect(response.data).toEqual([{ id: 'int_1' }])
    expect(mockSyncOrganizationOAuthIntegrations).not.toHaveBeenCalled()
    expect(response.lastSyncedAt).toBeNull()
  })

  it('runs the sync when force_sync=true and returns the timestamp', async () => {
    mockGetQuery.mockReturnValue({ force_sync: 'true' })
    const handler = await importHandler()
    const response = await handler({} as any)

    expect(mockSyncOrganizationOAuthIntegrations).toHaveBeenCalledTimes(1)
    expect(mockSyncOrganizationOAuthIntegrations).toHaveBeenCalledWith({ db: true }, 'org_1')
    expect(response.syncStatus).toBe('synced')
    expect(typeof response.lastSyncedAt).toBe('string')
  })

  it('marks subsequent requests as cached after a forced sync', async () => {
    const handler = await importHandler()

    mockGetQuery.mockReturnValue({ force_sync: 'true' })
    const forced = await handler({} as any)
    expect(forced.syncStatus).toBe('synced')

    mockGetQuery.mockReturnValue({})
    const cached = await handler({} as any)
    expect(cached.syncStatus).toBe('cached')
    expect(cached.lastSyncedAt).toEqual(forced.lastSyncedAt)
    expect(mockSyncOrganizationOAuthIntegrations).toHaveBeenCalledTimes(1)
  })
})
