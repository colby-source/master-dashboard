-- Migration 007: Add post-meeting follow-up tracking to meeting_transcripts
-- Tracks automated follow-up status after meeting analysis

ALTER TABLE meeting_transcripts ADD COLUMN followup_status TEXT DEFAULT 'pending';
-- pending | scheduled | sent | skipped
ALTER TABLE meeting_transcripts ADD COLUMN followup_type TEXT;
-- data_room | nurture | polite_close
ALTER TABLE meeting_transcripts ADD COLUMN followup_thread_id INTEGER;
ALTER TABLE meeting_transcripts ADD COLUMN followup_scheduled_at TEXT;
ALTER TABLE meeting_transcripts ADD COLUMN opportunity_value INTEGER;
