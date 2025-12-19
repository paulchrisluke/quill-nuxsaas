-- Add unique constraint on (organization_id, type) to prevent duplicate integrations
-- This enforces one integration per type per organization

-- Step 1: Detect and deduplicate existing duplicates
-- For each duplicate group (organization_id, type), keep the row with:
--   1. Most recent updated_at (prefer active/updated integrations)
--   2. If tied, most recent created_at (prefer newer integrations)
--   3. If tied, smallest id (deterministic tie-breaker)
-- This ensures we keep the "best" integration when multiple exist for the same org/type

-- Create backup table to record rows that will be deleted
CREATE TABLE IF NOT EXISTS "integration_deleted_backup" (
  LIKE "integration" INCLUDING ALL
);

-- Use DO block to log IDs and insert into backup, then delete
DO $$
DECLARE
  rows_to_delete_ids INTEGER[];
  deleted_count INTEGER;
BEGIN
  -- Identify rows to delete using the same logic
  WITH duplicate_groups AS (
    SELECT
      "organization_id",
      "type",
      COUNT(*) as duplicate_count
    FROM "integration"
    GROUP BY "organization_id", "type"
    HAVING COUNT(*) > 1
  ),
  ranked_integrations AS (
    SELECT
      i."id",
      i."organization_id",
      i."type",
      ROW_NUMBER() OVER (
        PARTITION BY i."organization_id", i."type"
        ORDER BY
          i."updated_at" DESC NULLS LAST,
          i."created_at" DESC NULLS LAST,
          i."id" ASC
      ) as row_rank
    FROM "integration" i
    INNER JOIN duplicate_groups dg
      ON i."organization_id" = dg."organization_id"
      AND i."type" = dg."type"
  ),
  rows_to_delete AS (
    SELECT "id"
    FROM ranked_integrations
    WHERE row_rank > 1
  )
  SELECT ARRAY_AGG("id") INTO rows_to_delete_ids
  FROM rows_to_delete;

  -- Log the IDs that will be deleted
  IF array_length(rows_to_delete_ids, 1) > 0 THEN
    RAISE NOTICE 'Migration 0017: Will delete % integration row(s) with IDs: %', array_length(rows_to_delete_ids, 1), array_to_string(rows_to_delete_ids, ', ');

    -- Insert rows into backup table
    INSERT INTO "integration_deleted_backup"
    SELECT i.*
    FROM "integration" i
    WHERE i."id" = ANY(rows_to_delete_ids);

    -- Delete the duplicate rows
    DELETE FROM "integration"
    WHERE "id" = ANY(rows_to_delete_ids);

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RAISE NOTICE 'Migration 0017: Deleted % integration row(s). Backup saved to integration_deleted_backup table.', deleted_count;
  ELSE
    RAISE NOTICE 'Migration 0017: No duplicate integrations found. No rows to delete.';
  END IF;
END $$;

-- Step 2: Create the unique index
-- Note: For production deployments with large tables, consider splitting this migration:
--   1. Run Step 1 (data cleanup) in a transaction (this file)
--   2. Run index creation separately using CONCURRENTLY outside a transaction:
--      CREATE UNIQUE INDEX CONCURRENTLY "integration_org_type_unique_idx"
--        ON "integration" ("organization_id", "type");
-- CONCURRENTLY cannot be used inside a transaction block, but prevents table locking.
-- For development/test environments, the standard CREATE UNIQUE INDEX below is sufficient.
CREATE UNIQUE INDEX IF NOT EXISTS "integration_org_type_unique_idx"
  ON "integration" ("organization_id", "type");
