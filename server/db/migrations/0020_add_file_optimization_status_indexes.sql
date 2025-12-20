-- Add indexes for optimization_status to improve worker query performance
-- These indexes prevent full table scans when querying files by optimization status
--
-- IMPORTANT: These indexes use CONCURRENTLY to avoid blocking writes during creation.
-- CONCURRENTLY cannot be used inside a transaction block.
--
-- The drizzle.config.ts has been configured with migrations.transactional: false
-- to allow this migration to run without a transaction wrapper.
--
-- Error Handling:
-- - If an index already exists, IF NOT EXISTS will prevent errors
-- - If CONCURRENTLY fails (e.g., due to concurrent index creation), the error will
--   be reported by the migration runner. Common errors:
--   * "already exists" - Index was created by another process (safe to ignore with IF NOT EXISTS)
--   * "cannot run inside a transaction" - Migration runner is still using transactions (check drizzle.config.ts)
--   * "relation does not exist" - Table doesn't exist (check migration order)
--
-- For production safety, these indexes are created concurrently to prevent table locking.

-- Index on optimization_status alone for status filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS "file_optimization_status_idx" ON "file" ("optimization_status");--> statement-breakpoint

-- Composite index on (optimization_status, created_at) for time-ordered processing
-- This supports queries that need to process files in chronological order by status
CREATE INDEX CONCURRENTLY IF NOT EXISTS "file_optimization_status_created_at_idx" ON "file" ("optimization_status", "created_at");--> statement-breakpoint

-- Rollback: Drop the indexes if migration needs to be reversed
-- DROP INDEX IF EXISTS "file_optimization_status_created_at_idx";
-- DROP INDEX IF EXISTS "file_optimization_status_idx";
