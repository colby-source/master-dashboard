-- Migration 006: Add retry tracking to reply_messages
-- Prevents infinite retry loops on failed sends

ALTER TABLE reply_messages ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE reply_messages ADD COLUMN last_error TEXT;
