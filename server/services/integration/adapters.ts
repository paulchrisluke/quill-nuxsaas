import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type * as schema from '~~/server/db/schema'

export interface IntegrationAdapterContext {
  db: NodePgDatabase<typeof schema>
}

export interface IntegrationTestOptions {
  payload?: Record<string, any>
}

export interface IntegrationTestResult {
  success: boolean
  message?: string
  details?: Record<string, any>
}

export interface IntegrationAdapter {
  type: string
  testConnection: (
    integration: typeof schema.integration.$inferSelect,
    ctx: IntegrationAdapterContext,
    options?: IntegrationTestOptions
  ) => Promise<IntegrationTestResult>
}

const adapterRegistry: Record<string, IntegrationAdapter> = {}

const defaultAdapter: IntegrationAdapter = {
  type: 'default',
  async testConnection(integration) {
    return {
      success: false,
      message: `No adapter registered for integration type "${integration.type}"`
    }
  }
}

export const registerIntegrationAdapter = (adapter: IntegrationAdapter) => {
  adapterRegistry[adapter.type] = adapter
}

export const getIntegrationAdapter = (type: string): IntegrationAdapter => {
  return adapterRegistry[type] ?? defaultAdapter
}
