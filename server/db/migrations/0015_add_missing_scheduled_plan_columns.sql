-- Add missing scheduled_plan columns if they don't exist
-- This fixes the case where migration 0001 wasn't applied or columns were dropped

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'subscription'
      AND column_name = 'scheduled_plan_id'
  ) THEN
    ALTER TABLE "subscription" ADD COLUMN "scheduled_plan_id" text;
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'subscription'
      AND column_name = 'scheduled_plan_interval'
  ) THEN
    ALTER TABLE "subscription" ADD COLUMN "scheduled_plan_interval" text;
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'subscription'
      AND column_name = 'scheduled_plan_seats'
  ) THEN
    ALTER TABLE "subscription" ADD COLUMN "scheduled_plan_seats" integer;
  END IF;
END $$;--> statement-breakpoint

-- Add constraints if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'subscription'
      AND constraint_name = 'subscription_scheduled_plan_interval_check'
  ) THEN
    ALTER TABLE "subscription" ADD CONSTRAINT "subscription_scheduled_plan_interval_check"
      CHECK ("scheduled_plan_interval" IS NULL OR "scheduled_plan_interval" IN ('month','year'));
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'subscription'
      AND constraint_name = 'subscription_scheduled_plan_seats_check'
  ) THEN
    ALTER TABLE "subscription" ADD CONSTRAINT "subscription_scheduled_plan_seats_check"
      CHECK ("scheduled_plan_seats" IS NULL OR "scheduled_plan_seats" > 0);
  END IF;
END $$;
