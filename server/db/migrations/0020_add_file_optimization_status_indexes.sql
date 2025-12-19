-- Add indexes for optimization_status to improve worker query performance
-- These indexes prevent full table scans when querying files by optimization status

-- Index on optimization_status alone for status filtering
CREATE INDEX IF NOT EXISTS "file_optimization_status_idx" ON "file" ("optimization_status");--> statement-breakpoint

-- Composite index on (optimization_status, created_at) for time-ordered processing
-- This supports queries that need to process files in chronological order by status
CREATE INDEX IF NOT EXISTS "file_optimization_status_created_at_idx" ON "file" ("optimization_status", "created_at");--> statement-breakpoint

-- Rollback: Drop the indexes if migration needs to be reversed
-- DROP INDEX IF EXISTS "file_optimization_status_created_at_idx";
-- DROP INDEX IF EXISTS "file_optimization_status_idx";
