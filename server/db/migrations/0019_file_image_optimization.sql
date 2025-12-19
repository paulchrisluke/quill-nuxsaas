DO $$
BEGIN
  CREATE TYPE "file_optimization_status" AS ENUM ('pending', 'processing', 'done', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END;
$$;
--> statement-breakpoint

ALTER TABLE "file"
  ADD COLUMN IF NOT EXISTS "width" integer,
  ADD COLUMN IF NOT EXISTS "height" integer,
  ADD COLUMN IF NOT EXISTS "blur_data_url" text,
  ADD COLUMN IF NOT EXISTS "variants" jsonb,
  ADD COLUMN IF NOT EXISTS "optimization_status" "file_optimization_status" DEFAULT 'pending' NOT NULL,
  ADD COLUMN IF NOT EXISTS "optimization_error" text,
  ADD COLUMN IF NOT EXISTS "optimized_at" timestamp,
  ADD COLUMN IF NOT EXISTS "optimization_started_at" timestamp;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "file"
    WHERE "optimization_status" = 'done'
    LIMIT 1
  ) THEN
    UPDATE "file"
    SET "optimization_status" = 'done'
    WHERE "optimization_status" = 'pending'
      AND "width" IS NULL
      AND "height" IS NULL;
  END IF;
END;
$$;
