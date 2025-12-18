-- Add unique constraint on (organization_id, type) to prevent duplicate integrations
-- This enforces one integration per type per organization
CREATE UNIQUE INDEX IF NOT EXISTS "integration_org_type_unique_idx"
  ON "integration" ("organization_id", "type");
