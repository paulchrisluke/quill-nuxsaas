-- Convert created_at and updated_at from timestamp to timestamptz for consistency
-- with optimized_at and optimization_started_at fields
ALTER TABLE "file"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
--> statement-breakpoint
