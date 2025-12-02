# UUID Conversion Migration Guide

## Overview

Migration `0003_fuzzy_jackpot.sql` converts ID columns from `text` to `uuid` type for content-related tables. This improves database performance and ensures type safety.

## Affected Tables

The following tables have their `id` columns converted from `text` to `uuid`:

- `source_content`
- `content`
- `content_version`
- `publication`
- `content_chat_session`
- `content_chat_message`
- `content_chat_log`
- `chunk`

## Pre-Migration Safety Check

**IMPORTANT:** Before running the migration, verify that all existing IDs are valid UUID strings.

### Run the Safety Check

```bash
# Using psql
psql $DATABASE_URL -f scripts/check-migration-safety.sql

# Or using drizzle-kit
# The check script is in scripts/check-migration-safety.sql
```

### Expected Results

All `invalid_uuids` columns should be `0`. If any table shows `invalid_uuids > 0`, you must fix those records before running the migration.

### What to Do If Invalid UUIDs Are Found

1. Identify the records with invalid UUIDs
2. Either:
   - Delete the records (if they're test data)
   - Generate new UUIDs for them using `uuidv7()`
   - Create a data migration script to fix them

## Migration Steps

### 1. Backup Your Database

```bash
pg_dump $DATABASE_URL > backup_before_uuid_migration.sql
```

### 2. Run Pre-Migration Check

```bash
psql $DATABASE_URL -f scripts/check-migration-safety.sql
```

### 3. Apply Migration

```bash
pnpm db:migrate
```

### 4. Verify Migration

Check that:
- All foreign key constraints are recreated
- All indexes are intact
- Application still works correctly

## Post-Migration

### Type Safety Improvements

After migration, all API endpoints now validate UUIDs:

- `validateUUID()` - for required UUID fields
- `validateOptionalUUID()` - for optional UUID fields

### Updated Endpoints

The following endpoints now validate UUID format:

- `GET /api/content/[id]` - validates content ID
- `GET /api/source-content/[id]` - validates source content ID
- `POST /api/chat/[sessionId]/create-content` - validates session ID
- `GET /api/chat/workspace?contentId=...` - validates content ID
- `POST /api/content/generate` - validates sourceContentId and contentId
- `POST /api/content` - validates sourceContentId
- `POST /api/chat` - validates contentId and sourceContentId in actions

## Rollback Plan

If you need to rollback:

1. Restore from backup: `psql $DATABASE_URL < backup_before_uuid_migration.sql`
2. Or create a reverse migration that converts UUIDs back to text

**Note:** Rolling back requires converting UUIDs to text, which may lose precision if UUIDs were generated differently.

## Troubleshooting

### Migration Fails with "invalid input syntax for type uuid"

This means some IDs are not valid UUID strings. Run the safety check script to identify them.

### Foreign Key Constraint Errors

If you see FK errors during migration:
1. Check that parent tables are converted before child tables
2. Verify the migration order in the SQL file
3. The migration should handle this automatically by dropping FKs first

### Application Errors After Migration

If the app fails after migration:
1. Check that all UUID validations are in place
2. Verify that client code sends valid UUIDs
3. Check server logs for validation errors

## Related Files

- Migration: `server/database/migrations/0003_fuzzy_jackpot.sql`
- Safety Check: `scripts/check-migration-safety.sql`
- Validation Utils: `server/utils/validation.ts`
- Schema Definitions: `server/database/schema/*.ts`

