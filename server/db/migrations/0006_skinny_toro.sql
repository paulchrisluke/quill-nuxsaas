CREATE TABLE IF NOT EXISTS "audit_log_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text,
	"category" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"ip_address" text,
	"user_agent" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"details" text,
	"error" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_retry_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org_provisioning_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text,
	"error" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_retry_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "audit_log_queue"
  ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "org_provisioning_queue"
  ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'audit_log_queue_user_id_user_id_fk'
      AND table_schema = 'public'
      AND table_name = 'audit_log_queue'
  ) THEN
    ALTER TABLE "audit_log_queue" ADD CONSTRAINT "audit_log_queue_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'org_provisioning_queue_user_id_user_id_fk'
      AND table_schema = 'public'
      AND table_name = 'org_provisioning_queue'
  ) THEN
    ALTER TABLE "org_provisioning_queue" ADD CONSTRAINT "org_provisioning_queue_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
