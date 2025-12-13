#!/usr/bin/env tsx
/**
 * Backfill script to set isAnonymous = true for existing organizations
 * that have slugs starting with 'anonymous-'.
 *
 * Run this after applying the migration that adds the isAnonymous column.
 *
 * Usage: pnpm db:backfill-is-anonymous
 */

import * as dotenv from 'dotenv'
import { Pool } from 'pg'

// Load environment variables
dotenv.config()

async function backfillIsAnonymous() {
  console.log('Starting backfill of isAnonymous column...\n')

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is not set')
    process.exit(1)
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  })

  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // Update all organizations with slugs starting with 'anonymous-' to have isAnonymous = true
    const result = await client.query(
      `UPDATE "organization"
       SET "is_anonymous" = true
       WHERE "slug" LIKE 'anonymous-%'
       RETURNING "id", "slug"`
    )

    console.log(`Updated ${result.rows.length} organizations to isAnonymous = true`)
    if (result.rows.length > 0) {
      console.log('Updated organizations:')
      result.rows.forEach((org) => {
        console.log(`  - ${org.slug} (${org.id})`)
      })
    }

    // Also ensure all organizations without 'anonymous-' prefix have isAnonymous = false
    // (This is a safety check in case the default value wasn't applied correctly)
    await client.query(
      `UPDATE "organization"
       SET "is_anonymous" = false
       WHERE "slug" NOT LIKE 'anonymous-%'
       AND ("is_anonymous" IS NULL OR "is_anonymous" = true)`
    )

    await client.query('COMMIT')
    console.log('\n✅ Ensured all non-anonymous organizations have isAnonymous = false')
    console.log('\n✅ Backfill completed successfully!')
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('❌ Error during backfill:', error)
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

backfillIsAnonymous()
  .then(() => {
    process.exit(0)
  })
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
