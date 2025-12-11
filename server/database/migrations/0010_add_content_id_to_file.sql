ALTER TABLE "file" ADD COLUMN IF NOT EXISTS "content_id" uuid;

ALTER TABLE "file"
  ADD CONSTRAINT "file_content_id_content_id_fk"
  FOREIGN KEY ("content_id") REFERENCES "content"("id") ON DELETE SET NULL;
