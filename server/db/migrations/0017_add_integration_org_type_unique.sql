-- Add unique constraint on (organization_id, type) to prevent duplicate integrations
-- This enforces one integration per type per organization

-- Step 1: Detect and deduplicate existing duplicates
-- For each duplicate group (organization_id, type), keep the row with:
--   1. Most recent updated_at (prefer active/updated integrations)
--   2. If tied, most recent created_at (prefer newer integrations)
--   3. If tied, smallest id (deterministic tie-breaker)
-- This ensures we keep the "best" integration when multiple exist for the same org/type
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
DELETE FROM "integration"
WHERE "id" IN (SELECT "id" FROM rows_to_delete);

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
