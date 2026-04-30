-- Migration 025: Video processing & delivery tracking
-- Adds transcript storage to longform_sources (filled when a video is transcribed)
-- and a delivery flag on launchpad_brands so we know when the final deliverables
-- have been written to Drive (Google Docs + calendar Sheet).

ALTER TABLE launchpad_longform_sources ADD COLUMN transcript TEXT;
ALTER TABLE launchpad_longform_sources ADD COLUMN transcript_segments TEXT; -- JSON: [{start, end, text}]

ALTER TABLE launchpad_brands ADD COLUMN deliverables_written_at TEXT;
ALTER TABLE launchpad_brands ADD COLUMN deliverables_drive_links TEXT; -- JSON map: {moduleN: url}
