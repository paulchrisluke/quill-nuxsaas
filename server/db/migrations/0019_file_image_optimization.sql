DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'file_optimization_status'
  ) THEN
    CREATE TYPE "file_optimization_status" AS ENUM ('pending', 'processing', 'done', 'failed', 'skipped');
  END IF;
END $$;--> statement-breakpoint

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
    -- Mark files with NULL dimensions as 'skipped' since they are non-image files
    -- that don't require image optimization (e.g., PDFs, documents, etc.)
    UPDATE "file"
    SET "optimization_status" = 'skipped'
    WHERE "optimization_status" = 'pending'
      AND "width" IS NULL
      AND "height" IS NULL;
  END IF;
END $$;--> statement-breakpoint
