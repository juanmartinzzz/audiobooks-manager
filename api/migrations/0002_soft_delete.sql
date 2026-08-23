-- Rebuild tables so every row has created_at, updated_at, removed_at.
-- Foreign keys no longer cascade; unique indexes ignore soft-deleted rows.

CREATE TABLE audiobooks_new (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT,
  author TEXT,
  narrator TEXT,
  series_title TEXT,
  series_index INTEGER,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  removed_at INTEGER
);

INSERT INTO audiobooks_new (
  id, title, subtitle, author, narrator, series_title, series_index, description,
  created_at, updated_at, removed_at
)
SELECT
  id, title, subtitle, author, narrator, series_title, series_index, description,
  created_at, updated_at, NULL
FROM audiobooks;

CREATE TABLE assets_new (
  id TEXT PRIMARY KEY,
  audiobook_id TEXT NOT NULL REFERENCES audiobooks_new(id),
  r2_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('audio', 'cover')),
  content_type TEXT,
  size_bytes INTEGER,
  duration_seconds REAL,
  original_filename TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  removed_at INTEGER
);

INSERT INTO assets_new (
  id, audiobook_id, r2_key, kind, content_type, size_bytes, duration_seconds,
  original_filename, created_at, updated_at, removed_at
)
SELECT
  id, audiobook_id, r2_key, kind, content_type, size_bytes, duration_seconds,
  original_filename, created_at, created_at, NULL
FROM assets;

CREATE TABLE chapters_new (
  id TEXT PRIMARY KEY,
  audiobook_id TEXT NOT NULL REFERENCES audiobooks_new(id),
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  audio_asset_id TEXT REFERENCES assets_new(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  removed_at INTEGER
);

INSERT INTO chapters_new (
  id, audiobook_id, position, title, audio_asset_id, created_at, updated_at, removed_at
)
SELECT
  id, audiobook_id, position, title, audio_asset_id, created_at, updated_at, NULL
FROM chapters;

CREATE TABLE playback_progress_new (
  audiobook_id TEXT NOT NULL REFERENCES audiobooks_new(id),
  chapter_id TEXT NOT NULL REFERENCES chapters_new(id),
  position_seconds REAL NOT NULL DEFAULT 0,
  duration_seconds REAL,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  removed_at INTEGER,
  PRIMARY KEY (audiobook_id, chapter_id)
);

INSERT INTO playback_progress_new (
  audiobook_id, chapter_id, position_seconds, duration_seconds, completed,
  created_at, updated_at, removed_at
)
SELECT
  audiobook_id, chapter_id, position_seconds, duration_seconds, completed,
  updated_at, updated_at, NULL
FROM playback_progress;

CREATE TABLE playback_settings_new (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  segment_minutes INTEGER NOT NULL DEFAULT 5,
  skip_back_seconds INTEGER NOT NULL DEFAULT 15,
  skip_forward_seconds INTEGER NOT NULL DEFAULT 30,
  pause_at_segment_end INTEGER NOT NULL DEFAULT 0 CHECK (pause_at_segment_end IN (0, 1)),
  auto_next_chapter INTEGER NOT NULL DEFAULT 0 CHECK (auto_next_chapter IN (0, 1)),
  playback_rate REAL NOT NULL DEFAULT 1.0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  removed_at INTEGER
);

INSERT INTO playback_settings_new (
  id, segment_minutes, skip_back_seconds, skip_forward_seconds,
  pause_at_segment_end, auto_next_chapter, playback_rate,
  created_at, updated_at, removed_at
)
SELECT
  id, segment_minutes, skip_back_seconds, skip_forward_seconds,
  pause_at_segment_end, auto_next_chapter, playback_rate,
  (unixepoch() * 1000), (unixepoch() * 1000), NULL
FROM playback_settings;

DROP TABLE playback_progress;
DROP TABLE chapters;
DROP TABLE assets;
DROP TABLE audiobooks;
DROP TABLE playback_settings;

ALTER TABLE audiobooks_new RENAME TO audiobooks;
ALTER TABLE assets_new RENAME TO assets;
ALTER TABLE chapters_new RENAME TO chapters;
ALTER TABLE playback_progress_new RENAME TO playback_progress;
ALTER TABLE playback_settings_new RENAME TO playback_settings;

CREATE UNIQUE INDEX idx_assets_one_cover
  ON assets(audiobook_id) WHERE kind = 'cover' AND removed_at IS NULL;

CREATE INDEX idx_assets_audiobook
  ON assets(audiobook_id, kind) WHERE removed_at IS NULL;

CREATE UNIQUE INDEX idx_chapters_position
  ON chapters(audiobook_id, position) WHERE removed_at IS NULL;

CREATE INDEX idx_chapters_audiobook
  ON chapters(audiobook_id, position) WHERE removed_at IS NULL;

CREATE INDEX idx_audiobooks_updated
  ON audiobooks(updated_at DESC) WHERE removed_at IS NULL;
