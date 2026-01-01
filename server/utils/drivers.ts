import Redis from 'ioredis'
import pg from 'pg'
import { Resend } from 'resend'
import { runtimeConfig } from './runtimeConfig'

const getDatabaseUrl = () => {
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
let redis: Redis | undefined
if (runtimeConfig.redisUrl) {
  redis = new Redis(runtimeConfig.redisUrl)
}

export const cacheClient = {
  get: async (key: string) => {
    if (redis) {
      return await redis.get(key)
    }
    return null
  },
  set: async (key: string, value: string, ttl: number | undefined) => {
    if (redis) {
      if (ttl) {
        await redis.set(key, value, 'EX', ttl)
      } else {
        await redis.set(key, value)
      }
    }
  },
  delete: async (key: string) => {
    if (redis) {
      await redis.del(key)
    }
  }
}

export const resendInstance = new Resend(runtimeConfig.resendApiKey)
