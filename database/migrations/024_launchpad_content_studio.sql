-- Migration 024: Launchpad Content Studio (Opus-style long-form → short-form pipeline)
-- Two new tables: longform_sources stores AI-generated scripts + creator-uploaded
-- video/audio/articles. clips stores the chopped short-form pieces (carousels,
-- quotes, video clips, single posts) that map to days on the 30-day calendar.

CREATE TABLE IF NOT EXISTS launchpad_longform_sources (
  id TEXT PRIMARY KEY,                    -- 'lfs_<random>'
  brand_id TEXT NOT NULL,

  source_type TEXT NOT NULL,
  -- 'generated_script' | 'uploaded_video' | 'uploaded_audio' | 'uploaded_article'

  pillar_number INTEGER,                  -- 1-5, nullable for uploads not yet pillar-tagged
  title TEXT NOT NULL,
  body TEXT,                              -- full text for scripts/articles, transcript for video/audio

  duration_seconds INTEGER,               -- video/audio only
  drive_file_id TEXT,                     -- uploaded media only
  drive_file_url TEXT,
  mime_type TEXT,
  size_bytes INTEGER,

  status TEXT NOT NULL DEFAULT 'ready',
  -- 'pending_processing' | 'processing' | 'ready' | 'error'

  processing_started_at TEXT,
  processing_completed_at TEXT,
  error TEXT,

  metadata TEXT,                          -- JSON

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (brand_id) REFERENCES launchpad_brands(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lfs_brand ON launchpad_longform_sources(brand_id, source_type);
CREATE INDEX IF NOT EXISTS idx_lfs_status ON launchpad_longform_sources(status, processing_started_at);

CREATE TABLE IF NOT EXISTS launchpad_clips (
  id TEXT PRIMARY KEY,                    -- 'clp_<random>'
  brand_id TEXT NOT NULL,
  source_id TEXT,                         -- references launchpad_longform_sources, nullable for misc clips

  clip_type TEXT NOT NULL,
  -- 'video_clip' | 'carousel' | 'quote' | 'single_post' | 'thread'

  format TEXT NOT NULL,
  -- 'reel' | 'carousel' | 'static' | 'story' | 'long_video'

  hook TEXT NOT NULL,                     -- first 3 seconds / first line
  body TEXT NOT NULL,                     -- full caption / script / carousel slides JSON
  cta TEXT,
  visual_direction TEXT,
  hashtags TEXT,                          -- JSON array

  pillar_number INTEGER,                  -- 1-5
  assigned_day INTEGER,                   -- 1-30, nullable until mapped to calendar
  best_post_time TEXT,                    -- "7:42pm ET"

  approval_status TEXT NOT NULL DEFAULT 'pending',
  -- 'pending' | 'approved' | 'rejected' | 'regenerating'

  approval_feedback TEXT,
  reviewed_at TEXT,

  drive_file_id TEXT,                     -- video clip Drive file
  drive_file_url TEXT,

  -- Video-specific fields
  source_start_seconds REAL,              -- in-point in source video
  source_end_seconds REAL,                -- out-point

  metadata TEXT,                          -- JSON: slide content for carousels, scoring etc.

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (brand_id) REFERENCES launchpad_brands(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES launchpad_longform_sources(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_clips_brand ON launchpad_clips(brand_id, approval_status);
CREATE INDEX IF NOT EXISTS idx_clips_calendar ON launchpad_clips(brand_id, assigned_day);
CREATE INDEX IF NOT EXISTS idx_clips_source ON launchpad_clips(source_id);
