-- Migration script to rename chat tables to conversation tables
-- Run this after resetting the database (as requested)

-- Rename tables
ALTER TABLE content_chat_session RENAME TO conversation;
ALTER TABLE content_chat_message RENAME TO conversation_message;
ALTER TABLE content_chat_log RENAME TO conversation_log;

-- Rename enum type
ALTER TYPE chat_session_status RENAME TO conversation_status;

-- Rename columns in conversation_message
ALTER TABLE conversation_message RENAME COLUMN session_id TO conversation_id;

-- Rename columns in conversation_log
ALTER TABLE conversation_log RENAME COLUMN session_id TO conversation_id;

-- Add conversationId column to content table
ALTER TABLE content ADD COLUMN conversation_id UUID REFERENCES conversation(id) ON DELETE SET NULL;

-- Create index on conversationId in content
CREATE INDEX content_conversation_idx ON content(conversation_id);

-- Rename indexes
ALTER INDEX content_chat_session_org_idx RENAME TO conversation_org_idx;
ALTER INDEX content_chat_session_content_idx RENAME TO conversation_content_idx;
ALTER INDEX content_chat_session_source_idx RENAME TO conversation_source_idx;

ALTER INDEX content_chat_message_session_idx RENAME TO conversation_message_conversation_idx;
ALTER INDEX content_chat_message_org_idx RENAME TO conversation_message_org_idx;
ALTER INDEX content_chat_message_created_idx RENAME TO conversation_message_created_idx;

ALTER INDEX content_chat_log_session_idx RENAME TO conversation_log_conversation_idx;
ALTER INDEX content_chat_log_org_idx RENAME TO conversation_log_org_idx;
ALTER INDEX content_chat_log_type_idx RENAME TO conversation_log_type_idx;

-- Migrate existing data: link content to conversation via conversation.contentId
-- This will set content.conversationId from conversation.contentId where they match
UPDATE content c
SET conversation_id = conv.id
FROM conversation conv
WHERE conv.content_id = c.id;
