DO $$ BEGIN
  CREATE TYPE "file_optimization_status" AS ENUM ('pending', 'processing', 'done', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

ALTER TABLE "file"
  ADD COLUMN IF NOT EXISTS "width" integer,
  ADD COLUMN IF NOT EXISTS "height" integer,
  ADD COLUMN IF NOT EXISTS "blur_data_url" text,
  ADD COLUMN IF NOT EXISTS "variants" jsonb,
  ADD COLUMN IF NOT EXISTS "optimization_status" "file_optimization_status" DEFAULT 'pending' NOT NULL,
  ADD COLUMN IF NOT EXISTS "optimization_error" text,
  ADD COLUMN IF NOT EXISTS "optimized_at" timestamp;
