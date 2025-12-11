ALTER TYPE "public"."chat_session_status" RENAME TO "conversation_status";--> statement-breakpoint
ALTER TABLE "content_chat_session" RENAME TO "conversation";--> statement-breakpoint
ALTER TABLE "content_chat_log" RENAME TO "conversation_log";--> statement-breakpoint
ALTER TABLE "content_chat_message" RENAME TO "conversation_message";--> statement-breakpoint
ALTER TABLE "conversation_log" RENAME COLUMN "session_id" TO "conversation_id";--> statement-breakpoint
ALTER TABLE "conversation_message" RENAME COLUMN "session_id" TO "conversation_id";--> statement-breakpoint
ALTER TABLE "conversation_log" DROP CONSTRAINT "content_chat_log_session_id_content_chat_session_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation_log" DROP CONSTRAINT "content_chat_log_organization_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation_message" DROP CONSTRAINT "content_chat_message_session_id_content_chat_session_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation_message" DROP CONSTRAINT "content_chat_message_organization_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation" DROP CONSTRAINT "content_chat_session_organization_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation" DROP CONSTRAINT "content_chat_session_content_id_content_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation" DROP CONSTRAINT "content_chat_session_source_content_id_source_content_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation" DROP CONSTRAINT "content_chat_session_created_by_user_id_user_id_fk";
--> statement-breakpoint
DROP INDEX "content_chat_log_session_idx";--> statement-breakpoint
DROP INDEX "content_chat_log_org_idx";--> statement-breakpoint
DROP INDEX "content_chat_log_type_idx";--> statement-breakpoint
DROP INDEX "content_chat_message_session_idx";--> statement-breakpoint
DROP INDEX "content_chat_message_org_idx";--> statement-breakpoint
DROP INDEX "content_chat_message_created_idx";--> statement-breakpoint
DROP INDEX "content_chat_session_org_idx";--> statement-breakpoint
DROP INDEX "content_chat_session_content_idx";--> statement-breakpoint
DROP INDEX "content_chat_session_source_idx";--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_log" ADD CONSTRAINT "conversation_log_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_log" ADD CONSTRAINT "conversation_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_source_content_id_source_content_id_fk" FOREIGN KEY ("source_content_id") REFERENCES "public"."source_content"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_log_conversation_idx" ON "conversation_log" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_log_org_idx" ON "conversation_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "conversation_log_type_idx" ON "conversation_log" USING btree ("type");--> statement-breakpoint
CREATE INDEX "conversation_message_conversation_idx" ON "conversation_message" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_message_org_idx" ON "conversation_message" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "conversation_message_created_idx" ON "conversation_message" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "conversation_org_idx" ON "conversation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "conversation_content_idx" ON "conversation" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "conversation_source_idx" ON "conversation" USING btree ("source_content_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_org_content_unique_idx" ON "conversation" USING btree ("organization_id","content_id") WHERE "conversation"."content_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "content_conversation_idx" ON "content" USING btree ("conversation_id");