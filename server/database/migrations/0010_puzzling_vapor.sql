ALTER TABLE "conversation" DROP CONSTRAINT "conversation_content_id_content_id_fk";
--> statement-breakpoint
DROP INDEX "conversation_content_idx";--> statement-breakpoint
DROP INDEX "conversation_org_content_unique_idx";--> statement-breakpoint
ALTER TABLE "conversation" DROP COLUMN "content_id";