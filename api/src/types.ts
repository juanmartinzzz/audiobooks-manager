export type AssetKind = "audio" | "cover";

export type AudiobookRecord = {
  id: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  narrator: string | null;
  series_title: string | null;
  series_index: number | null;
  description: string | null;
  created_at: number;
  updated_at: number;
};

export type ChapterRecord = {
  id: string;
  audiobook_id: string;
  position: number;
  title: string;
  audio_asset_id: string | null;
  created_at: number;
  updated_at: number;
  duration_seconds: number | null;
  size_bytes: number | null;
};

export type Audiobook = {
  id: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  narrator: string | null;
  seriesTitle: string | null;
  seriesIndex: number | null;
  description: string | null;
  createdAt: number;
  updatedAt: number;
  chapterCount: number;
};

export type Chapter = {
  id: string;
  audiobookId: string;
  position: number;
  title: string;
  audioAssetId: string | null;
  durationSeconds: number | null;
  sizeBytes: number | null;
  createdAt: number;
  updatedAt: number;
};

export type Asset = {
  id: string;
  audiobookId: string;
  r2Key: string;
  kind: AssetKind;
  contentType: string | null;
  sizeBytes: number | null;
  durationSeconds: number | null;
  originalFilename: string | null;
  createdAt: number;
  updatedAt: number;
};

export type CreateAudiobookInput = {
  title: string;
  subtitle?: string | null;
  author?: string | null;
  narrator?: string | null;
  seriesTitle?: string | null;
  seriesIndex?: number | null;
  description?: string | null;
};

export type CreateChapterInput = {
  title: string;
  position?: number;
};
