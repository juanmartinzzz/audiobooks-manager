-- Proposed v1 schema (single-user app).
-- Audio bytes live in R2. This database stores entities and R2 object references.
-- Upload of actual files is a later step; audio_asset_id / r2_key stay nullable until then.

CREATE TABLE audiobooks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT,
  author TEXT,
  narrator TEXT,
  series_title TEXT,
  series_index INTEGER,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  audiobook_id TEXT NOT NULL REFERENCES audiobooks(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('audio', 'cover')),
  content_type TEXT,
  size_bytes INTEGER,
  duration_seconds REAL,
  original_filename TEXT,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_assets_one_cover
  ON assets(audiobook_id) WHERE kind = 'cover';

CREATE INDEX idx_assets_audiobook ON assets(audiobook_id, kind);

CREATE TABLE chapters (
  id TEXT PRIMARY KEY,
  audiobook_id TEXT NOT NULL REFERENCES audiobooks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  audio_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (audiobook_id, position)
);

CREATE INDEX idx_chapters_audiobook ON chapters(audiobook_id, position);

-- One row per chapter, for this single-user app. Add a user_id later if needed.
CREATE TABLE playback_progress (
  audiobook_id TEXT NOT NULL REFERENCES audiobooks(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  position_seconds REAL NOT NULL DEFAULT 0,
  duration_seconds REAL,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (audiobook_id, chapter_id)
);

-- Player defaults from the sample HTML (segment length, skip, auto-next).
-- Single row until there are users.
CREATE TABLE playback_settings (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  segment_minutes INTEGER NOT NULL DEFAULT 5,
  skip_back_seconds INTEGER NOT NULL DEFAULT 15,
  skip_forward_seconds INTEGER NOT NULL DEFAULT 30,
  pause_at_segment_end INTEGER NOT NULL DEFAULT 0 CHECK (pause_at_segment_end IN (0, 1)),
  auto_next_chapter INTEGER NOT NULL DEFAULT 0 CHECK (auto_next_chapter IN (0, 1)),
  playback_rate REAL NOT NULL DEFAULT 1.0
);

INSERT INTO playback_settings (id) VALUES ('default');
