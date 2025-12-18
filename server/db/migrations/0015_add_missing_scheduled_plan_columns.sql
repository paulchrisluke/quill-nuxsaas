-- Add missing scheduled_plan columns if they don't exist
-- This fixes the case where migration 0001 wasn't applied or columns were dropped
-- Note: Constraints are added by migration 0001, so we only add columns here

ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "scheduled_plan_id" text;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "scheduled_plan_interval" text;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "scheduled_plan_seats" integer;
