CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "pg_uuidv7";
--> statement-breakpoint
CREATE TABLE "integration" (
    "id" uuid PRIMARY KEY NOT NULL,
    "organization_id" text NOT NULL,
    "type" text NOT NULL,
    "name" text NOT NULL,
    "auth_type" text NOT NULL,
    "account_id" text,
    "base_url" text,
    "config" jsonb,
    "capabilities" jsonb,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "integration_org_idx" ON "integration" ("organization_id");
--> statement-breakpoint
CREATE INDEX "integration_type_idx" ON "integration" ("type");
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_org_type_account_not_null_idx"
  ON "integration" ("organization_id", "type", "account_id")
  WHERE "account_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_org_type_null_account_idx"
  ON "integration" ("organization_id", "type")
  WHERE "account_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "publication" ADD COLUMN "integration_id_v2" uuid;
--> statement-breakpoint
INSERT INTO "integration" (
    "id",
    "organization_id",
    "type",
    "name",
    "auth_type",
    "account_id",
    "base_url",
    "config",
    "capabilities",
    "is_active",
    "created_at",
    "updated_at"
)
SELECT
    uuid_generate_v7() AS id,
    m.organization_id,
    'youtube' AS type,
    'YouTube' AS name,
    'oauth' AS auth_type,
    a.id AS account_id,
    NULL::text AS base_url,
    NULL::jsonb AS config,
    jsonb_build_object('ingest', true) AS capabilities,
    true AS is_active,
    now() AS created_at,
    now() AS updated_at
FROM "account" a
JOIN "member" m ON m.user_id = a.user_id
WHERE a.provider_id = 'google'
  AND regexp_split_to_array(coalesce(a.scope, ''), '[, ]+') @> ARRAY['https://www.googleapis.com/auth/youtube', 'https://www.googleapis.com/auth/youtube.force-ssl']
ON CONFLICT ON CONSTRAINT "integration_org_type_account_not_null_idx" DO NOTHING;
--> statement-breakpoint
INSERT INTO "integration" (
    "id",
    "organization_id",
    "type",
    "name",
    "auth_type",
    "account_id",
    "base_url",
    "config",
    "capabilities",
    "is_active",
    "created_at",
    "updated_at"
)
SELECT
    uuid_generate_v7() AS id,
    m.organization_id,
    'google_drive' AS type,
    'Google Drive' AS name,
    'oauth' AS auth_type,
    a.id AS account_id,
    NULL::text AS base_url,
    NULL::jsonb AS config,
    jsonb_build_object('ingest', true) AS capabilities,
    true AS is_active,
    now() AS created_at,
    now() AS updated_at
FROM "account" a
JOIN "member" m ON m.user_id = a.user_id
WHERE a.provider_id = 'google'
  AND regexp_split_to_array(coalesce(a.scope, ''), '[, ]+') @> ARRAY['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/documents.readonly']
ON CONFLICT ON CONSTRAINT "integration_org_type_account_not_null_idx" DO NOTHING;
--> statement-breakpoint
INSERT INTO "integration" (
    "id",
    "organization_id",
    "type",
    "name",
    "auth_type",
    "account_id",
    "base_url",
    "config",
    "capabilities",
    "is_active",
    "created_at",
    "updated_at"
)
SELECT
    uuid_generate_v7() AS id,
    m.organization_id,
    'github' AS type,
    'GitHub' AS name,
    'oauth' AS auth_type,
    a.id AS account_id,
    NULL::text AS base_url,
    NULL::jsonb AS config,
    jsonb_build_object('sync', true) AS capabilities,
    true AS is_active,
    now() AS created_at,
    now() AS updated_at
FROM "account" a
JOIN "member" m ON m.user_id = a.user_id
WHERE a.provider_id = 'github'
  AND regexp_split_to_array(coalesce(a.scope, ''), '[, ]+') @> ARRAY['repo']
ON CONFLICT ON CONSTRAINT "integration_org_type_account_not_null_idx" DO NOTHING;
--> statement-breakpoint
WITH missing_account_integration AS (
    SELECT DISTINCT
        p.organization_id,
        sc.source_type
    FROM "publication" p
    JOIN "content" c ON c.id = p.content_id
    JOIN "source_content" sc ON sc.id = c.source_content_id
    LEFT JOIN "account" a ON a.id = p.integration_id
    WHERE p.integration_id IS NOT NULL
      AND a.id IS NULL
      AND sc.source_type IN ('youtube', 'google_drive', 'github', 'github_repo')
)
INSERT INTO "integration" (
    "id",
    "organization_id",
    "type",
    "name",
    "auth_type",
    "account_id",
    "base_url",
    "config",
    "capabilities",
    "is_active",
    "created_at",
    "updated_at"
)
SELECT
    uuid_generate_v7() AS id,
    missing.organization_id,
    CASE
        WHEN missing.source_type = 'youtube' THEN 'youtube'
        WHEN missing.source_type = 'google_drive' THEN 'google_drive'
        ELSE 'github'
    END AS type,
    CASE
        WHEN missing.source_type = 'youtube' THEN 'YouTube'
        WHEN missing.source_type = 'google_drive' THEN 'Google Drive'
        ELSE 'GitHub'
    END AS name,
    'oauth' AS auth_type,
    NULL::text AS account_id,
    NULL::text AS base_url,
    NULL::jsonb AS config,
    CASE
        WHEN missing.source_type IN ('github', 'github_repo') THEN jsonb_build_object('sync', true)
        ELSE jsonb_build_object('ingest', true)
    END AS capabilities,
    true AS is_active,
    now() AS created_at,
    now() AS updated_at
FROM missing_account_integration missing
ON CONFLICT ON CONSTRAINT "integration_org_type_null_account_idx" DO NOTHING;
--> statement-breakpoint
WITH account_integration_map AS (
    SELECT
        p.integration_id AS account_id,
        p.organization_id,
        MIN(i.id) AS integration_id
    FROM "publication" p
    JOIN "integration" i
      ON i.account_id = p.integration_id
     AND i.organization_id = p.organization_id
    WHERE p.integration_id IS NOT NULL
    GROUP BY p.integration_id, p.organization_id
)
UPDATE "publication" p
SET "integration_id_v2" = map.integration_id
FROM account_integration_map map
WHERE p.integration_id = map.account_id
  AND p.organization_id = map.organization_id;
--> statement-breakpoint
ALTER TABLE "publication" DROP CONSTRAINT IF EXISTS "publication_integration_id_account_id_fk";
--> statement-breakpoint
ALTER TABLE "publication" DROP COLUMN "integration_id";
--> statement-breakpoint
ALTER TABLE "publication" RENAME COLUMN "integration_id_v2" TO "integration_id";
--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "publication_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE set null ON UPDATE no action;
