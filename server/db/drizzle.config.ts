import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema/index.ts',
  out: './server/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL!
  },
  // Note: Setting transactional to false allows CREATE INDEX CONCURRENTLY
  // and other operations that cannot run inside transactions.
  // This is required for migration 0020_add_file_optimization_status_indexes.sql
  // which uses CONCURRENTLY to avoid blocking writes during index creation.
  migrations: {
    transactional: false
  }
})
