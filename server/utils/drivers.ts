import { kv } from 'hub:kv'
import pg from 'pg'
import { Resend } from 'resend'
import { runtimeConfig } from './runtimeConfig'

const getDatabaseUrl = () => {
  // In Cloudflare Workers, bindings are only available within request context
  // When Better Auth is initialized at module load time, we must use DATABASE_URL
  // and NOT try to access Hyperdrive bindings, as that will throw "No request state found"
  if (runtimeConfig.preset === 'cloudflare-module') {
    // At module load time (when Better Auth is initialized), Hyperdrive bindings are not available
    // We must use DATABASE_URL directly. Hyperdrive will be used at request time via getPgPool()
    // which is called from within request handlers where bindings are available
    return runtimeConfig.databaseUrl
  }
  // For node-server preset, always use DATABASE_URL
  return runtimeConfig.databaseUrl
}

const createPgPool = () => new pg.Pool({
  connectionString: getDatabaseUrl(),
  max: 90,
  idleTimeoutMillis: 30000
})

let pgPool: pg.Pool

// PG Pool
export const getPgPool = () => {
  if (runtimeConfig.preset == 'node-server') {
    if (!pgPool) {
      pgPool = createPgPool()
    }
    return pgPool
  } else {
    return createPgPool()
  }
}

// Cache Client
export const cacheClient = {
  get: async (key: string) => {
    const value = await kv.get(key)
    if (value == null) {
      return null
    }
    return typeof value === 'string' ? value : JSON.stringify(value)
  },
  set: async (key: string, value: string, ttl: number | undefined) => {
    await kv.set(key, value, ttl ? { ttl } : undefined)
  },
  delete: async (key: string) => {
    await kv.del(key)
  }
}

export const resendInstance = new Resend(runtimeConfig.resendApiKey)
