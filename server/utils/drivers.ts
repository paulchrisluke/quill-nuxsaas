import type { Hyperdrive } from '@cloudflare/workers-types'
import { kv } from 'hub:kv'
import Redis from 'ioredis'
import pg from 'pg'
import { Resend } from 'resend'
import { runtimeConfig } from './runtimeConfig'

const DB_SLOW_QUERY_THRESHOLD_MS = 3000
const DB_QUERY_TIMEOUT_MS = 15000
const DB_POOL_WAIT_WARNING_MS = 3000

const getDatabaseUrl = () => {
  // @ts-expect-error globalThis.__env__ is not defined
  const hyperdrive = (process.env.HYPERDRIVE || globalThis.__env__?.HYPERDRIVE || globalThis.HYPERDRIVE) as Hyperdrive | undefined
  // Use Hyperdrive if available (prod Cloudflare), otherwise DATABASE_URL
  const url = hyperdrive?.connectionString || runtimeConfig.databaseUrl
  if (!url) {
    console.error('[DB] No database URL available - Hyperdrive:', !!hyperdrive, 'DATABASE_URL:', !!runtimeConfig.databaseUrl)
    throw new Error('Database connection string is not available')
  }
  // Log connection source (but not the actual URL for security)
  if (hyperdrive?.connectionString) {
    console.log('[DB] Using Hyperdrive connection')
  } else {
    console.log('[DB] Using DATABASE_URL connection')
  }
  return url
}

const instrumentPool = (pool: pg.Pool) => {
  const marker = '__quillio_instrumented'
  if ((pool as any)[marker]) {
    return pool
  }
  (pool as any)[marker] = true

  pool.on('error', (error) => {
    console.error('[DB] Pool error detected', { error })
  })

  const originalConnect = pool.connect.bind(pool)
  pool.connect = (async (...args) => {
    const start = Date.now()
    try {
      const client = await originalConnect(...args)
      const wait = Date.now() - start
      if (wait > DB_POOL_WAIT_WARNING_MS) {
        console.warn('[DB] Slow pool.connect detected', {
          waitMs: wait,
          total: pool.totalCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount
        })
      }
      return client
    } catch (error) {
      console.error('[DB] pool.connect failed', error)
      throw error
    }
  }) as typeof pool.connect

  const originalQuery = pool.query.bind(pool)
  pool.query = (async (...args) => {
    const start = Date.now()
    const queryPreview = extractQueryPreview(args)
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        console.error('[DB] Query exceeded timeout threshold', {
          timeoutMs: DB_QUERY_TIMEOUT_MS,
          query: queryPreview
        })
        const error = new Error(`Database query timed out after ${DB_QUERY_TIMEOUT_MS}ms`)
        ;(error as any).statusCode = 504
        reject(error)
      }, DB_QUERY_TIMEOUT_MS)
    })

    const queryPromise = originalQuery(...args)
    queryPromise.catch((error) => {
      console.error('[DB] Query failed', {
        error,
        query: queryPreview
      })
    })

    try {
      const result = await Promise.race([queryPromise, timeoutPromise])
      return result as Awaited<typeof queryPromise>
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      const duration = Date.now() - start
      if (duration > DB_SLOW_QUERY_THRESHOLD_MS) {
        console.warn('[DB] Slow query detected', {
          durationMs: duration,
          query: queryPreview
        })
      }
    }
  }) as typeof pool.query

  return pool
}

function extractQueryPreview(args: Parameters<pg.Pool['query']>): string {
  const [first] = args
  const queryText = typeof first === 'string'
    ? first
    : typeof first === 'object' && first && 'text' in first
      ? String((first as { text?: string }).text || '')
      : ''
  const normalized = queryText.replace(/\s+/g, ' ').trim()
  return normalized.length > 200 ? `${normalized.slice(0, 200)}…` : normalized || '[unknown query]'
}

const createPgPool = () => {
  const connectionString = getDatabaseUrl()
  console.log('[DB] Creating PostgreSQL pool with timeout settings')
  const pool = new pg.Pool({
    connectionString,
    max: 90,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000, // 10 second timeout to prevent hanging in Cloudflare Workers
    statement_timeout: 30000 // 30 second query timeout
  })
  return instrumentPool(pool)
}

const PG_POOL_KEY = '__quillio_pgPool'
type GlobalWithPool = typeof globalThis & { [PG_POOL_KEY]?: pg.Pool }
const globalRef = globalThis as GlobalWithPool

const getExistingPool = () => globalRef[PG_POOL_KEY]
const setExistingPool = (pool: pg.Pool) => {
  globalRef[PG_POOL_KEY] = pool
  return pool
}

// PG Pool
export const getPgPool = () => {
  const existingPool = getExistingPool()
  if (existingPool) {
    return existingPool
  }
  return setExistingPool(createPgPool())
}

// Cache Client
let redisClient: Redis | undefined

const getRedisClient = () => {
  if (redisClient) {
    return redisClient
  } else {
    if (runtimeConfig.preset == 'node-server') {
      redisClient = new Redis(runtimeConfig.redisUrl)
      return redisClient
    }
  }
}

export const cacheClient = {
  get: async (key: string) => {
    const client = getRedisClient()
    if (client) {
      const value = await client.get(key)
      return value
    } else {
      const value = await kv.get(key)
      if (!value) {
        return null
      }
      return JSON.stringify(value)
    }
  },
  set: async (key: string, value: string, ttl: number | undefined) => {
    const client = getRedisClient()
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value)
    if (client) {
      if (ttl) {
        await client.set(key, stringValue, 'EX', ttl)
      } else {
        await client.set(key, stringValue)
      }
    } else {
      if (ttl) {
        await kv.set(key, stringValue, { ttl })
      } else {
        await kv.set(key, stringValue)
      }
    }
  },
  delete: async (key: string) => {
    const client = getRedisClient()
    if (client) {
      await client.del(key)
    } else {
      await kv.del(key)
    }
  }
}

export const resendInstance = new Resend(runtimeConfig.resendApiKey)
