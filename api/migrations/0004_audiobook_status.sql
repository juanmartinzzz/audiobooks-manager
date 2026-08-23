-- Catalog lifecycle: books start as drafts (uploads and chapter edits)
-- and can be marked complete. Listening progress is a separate concept.

ALTER TABLE audiobooks ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
