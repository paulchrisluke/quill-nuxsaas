import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '~~/server/db/schema'

const connectionString = process.env.DATABASE_URL

if (!connectionString)
  throw new Error('DATABASE_URL is required for hub:db stub')

const client = postgres(connectionString, {
  max: 1,
  prepare: false
})

export const db = drizzle(client, { schema })
export { schema }

const cleanup = async () => {
  try {
    await client.end({ timeout: 5 })
  } catch (error) {
    console.error('Error closing database connection:', error)
  }
}

process.once('beforeExit', cleanup)
process.once('SIGTERM', cleanup)
process.once('SIGINT', cleanup)
