CREATE INDEX IF NOT EXISTS "file_optimization_status_idx" ON "file" ("optimization_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_optimization_status_created_at_idx" ON "file" ("optimization_status", "created_at");--> statement-breakpoint
