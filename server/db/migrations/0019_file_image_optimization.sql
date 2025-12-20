CREATE TYPE "public"."file_optimization_status" AS ENUM ('pending', 'processing', 'done', 'failed', 'skipped');

ALTER TABLE "file"
  ADD COLUMN IF NOT EXISTS "width" integer,
  ADD COLUMN IF NOT EXISTS "height" integer,
  ADD COLUMN IF NOT EXISTS "blur_data_url" text,
  ADD COLUMN IF NOT EXISTS "variants" jsonb,
  ADD COLUMN IF NOT EXISTS "optimization_status" "public"."file_optimization_status",
  ADD COLUMN IF NOT EXISTS "optimization_error" text,
  ADD COLUMN IF NOT EXISTS "optimized_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "optimization_started_at" timestamptz;

UPDATE "file"
SET optimization_status = 'skipped'
WHERE optimization_status IS NULL;

ALTER TABLE "file"
  ALTER COLUMN "optimization_status" SET DEFAULT 'pending',
  ALTER COLUMN "optimization_status" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "file_optimization_status_idx" ON "file" ("optimization_status");
CREATE INDEX IF NOT EXISTS "file_optimization_status_created_at_idx" ON "file" ("optimization_status", "created_at");

ALTER TABLE "file"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
