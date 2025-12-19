CREATE TYPE "public"."file_optimization_status" AS ENUM('pending', 'processing', 'done', 'failed', 'skipped');--> statement-breakpoint
ALTER TABLE "file"
  ADD COLUMN IF NOT EXISTS "width" integer,
  ADD COLUMN IF NOT EXISTS "height" integer,
  ADD COLUMN IF NOT EXISTS "blur_data_url" text,
  ADD COLUMN IF NOT EXISTS "variants" jsonb,
  ADD COLUMN IF NOT EXISTS "optimization_status" "public"."file_optimization_status" DEFAULT 'pending' NOT NULL,
  ADD COLUMN IF NOT EXISTS "optimization_error" text,
  ADD COLUMN IF NOT EXISTS "optimized_at" timestamp,
  ADD COLUMN IF NOT EXISTS "optimization_started_at" timestamp;
--> statement-breakpoint
