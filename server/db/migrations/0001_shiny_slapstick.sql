ALTER TABLE "subscription" ADD COLUMN "scheduled_plan_id" text;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "scheduled_plan_interval" text;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "scheduled_plan_seats" integer;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_scheduled_plan_interval_check"
  CHECK ("scheduled_plan_interval" IS NULL OR "scheduled_plan_interval" IN ('month','year'));--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_scheduled_plan_seats_check"
  CHECK ("scheduled_plan_seats" IS NULL OR "scheduled_plan_seats" > 0);
