ALTER TABLE "file" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
-- Create index for organization queries
CREATE INDEX IF NOT EXISTS "file_organization_idx" ON "file" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_organization_active_idx" ON "file" ("organization_id", "is_active");
--> statement-breakpoint
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
--> statement-breakpoint

-- Backfill organization_id from content table for existing files
UPDATE "file" AS f
SET "organization_id" = c."organization_id"
FROM "content" AS c
WHERE c."id" = f."content_id"
  AND f."content_id" IS NOT NULL
  AND f."organization_id" IS NULL;
--> statement-breakpoint
-- For files without content_id, deterministically map by earliest member record
WITH member_primary AS (
  SELECT DISTINCT ON ("user_id")
    "user_id",
    "organization_id"
  FROM "member"
  ORDER BY "user_id", "created_at" ASC
)
UPDATE "file" AS f
SET "organization_id" = mp."organization_id"
FROM member_primary AS mp
WHERE f."content_id" IS NULL
  AND f."organization_id" IS NULL
  AND f."uploaded_by" IS NOT NULL
  AND mp."user_id" = f."uploaded_by";
--> statement-breakpoint
-- Ensure no orphaned files remain before making the column required
DO $$
DECLARE
  missing_count bigint;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM "file"
  WHERE "organization_id" IS NULL;

  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Found % file records without organization_id after backfill', missing_count;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "file"
ALTER COLUMN "organization_id" SET NOT NULL;
