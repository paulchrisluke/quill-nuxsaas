CREATE TYPE "public"."chat_session_status" AS ENUM('active', 'archived', 'completed');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('draft', 'in_review', 'ready_for_publish', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."content_type" AS ENUM('blog_post', 'recipe', 'faq_page', 'course', 'how_to');--> statement-breakpoint
CREATE TYPE "public"."ingest_status" AS ENUM('pending', 'ingested', 'failed');--> statement-breakpoint
-- Drop foreign key constraints that reference columns we're converting
ALTER TABLE "chunk" DROP CONSTRAINT IF EXISTS "chunk_source_content_id_source_content_id_fk";--> statement-breakpoint
ALTER TABLE "content" DROP CONSTRAINT IF EXISTS "content_source_content_id_source_content_id_fk";--> statement-breakpoint
ALTER TABLE "content" DROP CONSTRAINT IF EXISTS "content_current_version_id_content_version_id_fk";--> statement-breakpoint
ALTER TABLE "content_version" DROP CONSTRAINT IF EXISTS "content_version_content_id_content_id_fk";--> statement-breakpoint
ALTER TABLE "publication" DROP CONSTRAINT IF EXISTS "publication_content_id_content_id_fk";--> statement-breakpoint
ALTER TABLE "publication" DROP CONSTRAINT IF EXISTS "publication_content_version_id_content_version_id_fk";--> statement-breakpoint
ALTER TABLE "content_chat_session" DROP CONSTRAINT IF EXISTS "content_chat_session_content_id_content_id_fk";--> statement-breakpoint
ALTER TABLE "content_chat_session" DROP CONSTRAINT IF EXISTS "content_chat_session_source_content_id_source_content_id_fk";--> statement-breakpoint
ALTER TABLE "content_chat_message" DROP CONSTRAINT IF EXISTS "content_chat_message_session_id_content_chat_session_id_fk";--> statement-breakpoint
ALTER TABLE "content_chat_log" DROP CONSTRAINT IF EXISTS "content_chat_log_session_id_content_chat_session_id_fk";--> statement-breakpoint
-- Convert parent table IDs first
ALTER TABLE "source_content" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "content" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "content_version" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "publication" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "content_chat_session" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
-- Convert foreign key columns
ALTER TABLE "chunk" ALTER COLUMN "source_content_id" SET DATA TYPE uuid USING "source_content_id"::uuid;--> statement-breakpoint
ALTER TABLE "content" ALTER COLUMN "source_content_id" SET DATA TYPE uuid USING "source_content_id"::uuid;--> statement-breakpoint
ALTER TABLE "content" ALTER COLUMN "current_version_id" SET DATA TYPE uuid USING "current_version_id"::uuid;--> statement-breakpoint
ALTER TABLE "content_version" ALTER COLUMN "content_id" SET DATA TYPE uuid USING "content_id"::uuid;--> statement-breakpoint
ALTER TABLE "publication" ALTER COLUMN "content_id" SET DATA TYPE uuid USING "content_id"::uuid;--> statement-breakpoint
ALTER TABLE "publication" ALTER COLUMN "content_version_id" SET DATA TYPE uuid USING "content_version_id"::uuid;--> statement-breakpoint
ALTER TABLE "content_chat_session" ALTER COLUMN "content_id" SET DATA TYPE uuid USING "content_id"::uuid;--> statement-breakpoint
ALTER TABLE "content_chat_session" ALTER COLUMN "source_content_id" SET DATA TYPE uuid USING "source_content_id"::uuid;--> statement-breakpoint
ALTER TABLE "content_chat_message" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "content_chat_message" ALTER COLUMN "session_id" SET DATA TYPE uuid USING "session_id"::uuid;--> statement-breakpoint
ALTER TABLE "content_chat_log" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "content_chat_log" ALTER COLUMN "session_id" SET DATA TYPE uuid USING "session_id"::uuid;--> statement-breakpoint
-- Recreate foreign key constraints
ALTER TABLE "chunk" ADD CONSTRAINT "chunk_source_content_id_source_content_id_fk" FOREIGN KEY ("source_content_id") REFERENCES "source_content"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_source_content_id_source_content_id_fk" FOREIGN KEY ("source_content_id") REFERENCES "source_content"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_current_version_id_content_version_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "content_version"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "content_version" ADD CONSTRAINT "content_version_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "content"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "publication_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "content"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "publication_content_version_id_content_version_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "content_version"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "content_chat_session" ADD CONSTRAINT "content_chat_session_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "content"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "content_chat_session" ADD CONSTRAINT "content_chat_session_source_content_id_source_content_id_fk" FOREIGN KEY ("source_content_id") REFERENCES "source_content"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "content_chat_message" ADD CONSTRAINT "content_chat_message_session_id_content_chat_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "content_chat_session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "content_chat_log" ADD CONSTRAINT "content_chat_log_session_id_content_chat_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "content_chat_session"("id") ON DELETE CASCADE;--> statement-breakpoint
-- Convert enum columns
ALTER TABLE "content_chat_session" ALTER COLUMN "status" SET DEFAULT 'active'::"public"."chat_session_status";--> statement-breakpoint
ALTER TABLE "content_chat_session" ALTER COLUMN "status" SET DATA TYPE "public"."chat_session_status" USING "status"::"public"."chat_session_status";--> statement-breakpoint
ALTER TABLE "content" ALTER COLUMN "status" SET DEFAULT 'draft'::"public"."content_status";--> statement-breakpoint
ALTER TABLE "content" ALTER COLUMN "status" SET DATA TYPE "public"."content_status" USING "status"::"public"."content_status";--> statement-breakpoint
ALTER TABLE "content" ALTER COLUMN "content_type" SET DEFAULT 'blog_post'::"public"."content_type";--> statement-breakpoint
ALTER TABLE "content" ALTER COLUMN "content_type" SET DATA TYPE "public"."content_type" USING "content_type"::"public"."content_type";--> statement-breakpoint
ALTER TABLE "source_content" ALTER COLUMN "ingest_status" SET DEFAULT 'pending'::"public"."ingest_status";--> statement-breakpoint
ALTER TABLE "source_content" ALTER COLUMN "ingest_status" SET DATA TYPE "public"."ingest_status" USING "ingest_status"::"public"."ingest_status";--> statement-breakpoint
-- Add indexes
CREATE INDEX "content_status_idx" ON "content" USING btree ("status");--> statement-breakpoint
CREATE INDEX "content_org_status_idx" ON "content" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "content_version_created_at_idx" ON "content_version" USING btree ("created_at");
