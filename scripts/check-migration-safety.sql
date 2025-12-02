-- Pre-migration safety check for UUID conversion
-- Run this BEFORE applying migration 0003_fuzzy_jackpot.sql
-- This script checks if all existing IDs are valid UUID strings

-- Check source_content table
SELECT 
  'source_content' as table_name,
  COUNT(*) as total_rows,
  COUNT(*) FILTER (WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') as invalid_uuids
FROM source_content

UNION ALL

-- Check content table
SELECT 
  'content' as table_name,
  COUNT(*) as total_rows,
  COUNT(*) FILTER (WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') as invalid_uuids
FROM content

UNION ALL

-- Check content_version table
SELECT 
  'content_version' as table_name,
  COUNT(*) as total_rows,
  COUNT(*) FILTER (WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') as invalid_uuids
FROM content_version

UNION ALL

-- Check publication table
SELECT 
  'publication' as table_name,
  COUNT(*) as total_rows,
  COUNT(*) FILTER (WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') as invalid_uuids
FROM publication

UNION ALL

-- Check content_chat_session table
SELECT 
  'content_chat_session' as table_name,
  COUNT(*) as total_rows,
  COUNT(*) FILTER (WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') as invalid_uuids
FROM content_chat_session

UNION ALL

-- Check content_chat_message table
SELECT 
  'content_chat_message' as table_name,
  COUNT(*) as total_rows,
  COUNT(*) FILTER (WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') as invalid_uuids
FROM content_chat_message

UNION ALL

-- Check content_chat_log table
SELECT 
  'content_chat_log' as table_name,
  COUNT(*) as total_rows,
  COUNT(*) FILTER (WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') as invalid_uuids
FROM content_chat_log

UNION ALL

-- Check chunk table
SELECT 
  'chunk' as table_name,
  COUNT(*) as total_rows,
  COUNT(*) FILTER (WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') as invalid_uuids
FROM chunk

ORDER BY table_name;

-- Summary: If all invalid_uuids columns are 0, the migration is safe to run.
-- If any invalid_uuids > 0, you need to fix those records before running the migration.

