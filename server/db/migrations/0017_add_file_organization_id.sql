-- Add organization_id column to file table
ALTER TABLE "file" ADD COLUMN IF NOT EXISTS "organization_id" text;

-- Create index for organization queries
CREATE INDEX IF NOT EXISTS "file_organization_idx" ON "file" ("organization_id");
CREATE INDEX IF NOT EXISTS "file_organization_active_idx" ON "file" ("organization_id", "is_active");

-- Add foreign key constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'file_organization_id_organization_id_fk'
  ) THEN
    ALTER TABLE "file"
    ADD CONSTRAINT "file_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- Backfill organization_id from content table for existing files
UPDATE "file"
SET "organization_id" = (
  SELECT "content"."organization_id"
  FROM "content"
  WHERE "content"."id" = "file"."content_id"
)
WHERE "file"."content_id" IS NOT NULL
  AND "file"."organization_id" IS NULL;

-- For files without content_id, try to get organization from uploaded_by user
UPDATE "file"
SET "organization_id" = (
  SELECT "member"."organization_id"
  FROM "member"
  WHERE "member"."user_id" = "file"."uploaded_by"
  LIMIT 1
)
WHERE "file"."content_id" IS NULL
  AND "file"."organization_id" IS NULL
  AND "file"."uploaded_by" IS NOT NULL;
