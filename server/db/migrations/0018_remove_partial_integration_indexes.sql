-- Remove partial unique indexes that conflict with the full unique index on (organization_id, type)
-- The intended model is one integration per (organization_id, type) regardless of account_id
-- Note: Duplicate (organization_id, type) pairs are handled by migration 0017_add_integration_org_type_unique.sql

-- Drop the partial unique indexes
DROP INDEX IF EXISTS "integration_org_type_account_not_null_idx";
DROP INDEX IF EXISTS "integration_org_type_null_account_idx";
