-- Remove partial unique indexes that conflict with the full unique index on (organization_id, type)
-- The intended model is one integration per (organization_id, type) regardless of account_id

-- First, validate that existing data conforms to the new constraint
-- Check for any duplicate (organization_id, type) pairs
DO $$
DECLARE
  duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT organization_id, type, COUNT(*) as cnt
    FROM integration
    GROUP BY organization_id, type
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Found % duplicate (organization_id, type) pairs. Please resolve duplicates before applying this migration.', duplicate_count;
  END IF;
END $$;

-- Drop the partial unique indexes
DROP INDEX IF EXISTS "integration_org_type_account_not_null_idx";
DROP INDEX IF EXISTS "integration_org_type_null_account_idx";
