-- Header facts captured at audio upload. Checksums are unique per book so the
-- same file cannot become two chapters without comparing names.

ALTER TABLE assets ADD COLUMN container TEXT;
ALTER TABLE assets ADD COLUMN bitrate INTEGER;
ALTER TABLE assets ADD COLUMN sample_rate INTEGER;
ALTER TABLE assets ADD COLUMN channels INTEGER;
ALTER TABLE assets ADD COLUMN checksum TEXT;
ALTER TABLE assets ADD COLUMN album TEXT;
ALTER TABLE assets ADD COLUMN artist TEXT;
ALTER TABLE assets ADD COLUMN narrator TEXT;

CREATE UNIQUE INDEX idx_assets_audiobook_audio_checksum
  ON assets(audiobook_id, checksum)
  WHERE kind = 'audio' AND checksum IS NOT NULL AND removed_at IS NULL;
