CREATE TABLE "integration" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"auth_type" text NOT NULL,
	"account_id" text,
	"base_url" text,
	"config" jsonb DEFAULT 'null'::jsonb,
	"capabilities" jsonb DEFAULT 'null'::jsonb,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "publication" DROP CONSTRAINT "publication_integration_id_account_id_fk";
--> statement-breakpoint
ALTER TABLE "publication" ALTER COLUMN "integration_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "file" ALTER COLUMN "uploaded_by" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "last_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "file" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_org_idx" ON "integration" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "integration_type_idx" ON "integration" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_org_type_account_not_null_idx" ON "integration" USING btree ("organization_id","type","account_id") WHERE "integration"."account_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_org_type_null_account_idx" ON "integration" USING btree ("organization_id","type") WHERE "integration"."account_id" IS NULL;--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "publication_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_organization_idx" ON "file" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "file_organization_active_idx" ON "file" USING btree ("organization_id","is_active");--> statement-breakpoint
-- Backfill organization_id from content table for existing files
UPDATE "file"
SET "organization_id" = (
  SELECT "content"."organization_id"
  FROM "content"
  WHERE "content"."id" = "file"."content_id"
)
WHERE "file"."content_id" IS NOT NULL
  AND "file"."organization_id" IS NULL;--> statement-breakpoint
-- For files without content_id, try to get organization from uploaded_by user
UPDATE "file"
SET "organization_id" = (
  SELECT "member"."organization_id"
  FROM "member"
  WHERE "member"."user_id" = "file"."uploaded_by"
  LIMIT 1
)
WHERE "file"."content_id" IS NULL
  AND "file"."organization_id" IS NULL
  AND "file"."uploaded_by" IS NOT NULL;
