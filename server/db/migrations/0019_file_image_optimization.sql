DO $$ BEGIN
    CREATE TYPE "public"."file_optimization_status" AS ENUM('pending', 'processing', 'done', 'failed', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "file"
  ADD COLUMN IF NOT EXISTS "width" integer,
  ADD COLUMN IF NOT EXISTS "height" integer,
  ADD COLUMN IF NOT EXISTS "blur_data_url" text,
  ADD COLUMN IF NOT EXISTS "variants" jsonb,
  ADD COLUMN IF NOT EXISTS "optimization_status" "public"."file_optimization_status",
  ADD COLUMN IF NOT EXISTS "optimization_error" text,
  ADD COLUMN IF NOT EXISTS "optimized_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "optimization_started_at" timestamptz;
--> statement-breakpoint
UPDATE "file" SET optimization_status = 'skipped' WHERE optimization_status IS NULL;
--> statement-breakpoint
ALTER TABLE "file"
  ALTER COLUMN "optimization_status" SET DEFAULT 'pending',
  ALTER COLUMN "optimization_status" SET NOT NULL;
--> statement-breakpoint
