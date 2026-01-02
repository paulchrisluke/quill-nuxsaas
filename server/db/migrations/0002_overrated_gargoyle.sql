ALTER TABLE "content_version" RENAME COLUMN "body_mdx" TO "body_markdown";--> statement-breakpoint
ALTER TABLE "content_version" DROP COLUMN "body_html";