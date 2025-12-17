ALTER TABLE "user"
DROP CONSTRAINT IF EXISTS "user_last_active_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "user"
DROP COLUMN IF EXISTS "last_active_organization_id";

DROP TABLE IF EXISTS "org_provisioning_queue";
