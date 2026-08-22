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

export type AudiobookDraft = {
  title: string;
  subtitle: string;
  author: string;
  narrator: string;
  seriesTitle: string;
  seriesIndex: string;
  description: string;
};

export const emptyAudiobookDraft = (): AudiobookDraft => ({
  title: "",
  subtitle: "",
  author: "",
  narrator: "",
  seriesTitle: "",
  seriesIndex: "",
  description: "",
});
