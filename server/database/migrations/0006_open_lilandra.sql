CREATE TABLE "quota_usage_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"quota_limit" integer,
	"used" integer NOT NULL,
	"remaining" integer,
	"profile" text,
	"label" text,
	"unlimited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quota_usage_log" ADD CONSTRAINT "quota_usage_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quota_usage_log_org_idx" ON "quota_usage_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "quota_usage_log_created_idx" ON "quota_usage_log" USING btree ("created_at");