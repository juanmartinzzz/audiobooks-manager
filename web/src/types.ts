export type AudiobookStatus = "draft" | "complete";

export type Audiobook = {
  id: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  narrator: string | null;
  seriesTitle: string | null;
  seriesIndex: number | null;
  description: string | null;
  status: AudiobookStatus;
  createdAt: number;
  updatedAt: number;
  chapterCount: number;
  hasCover: boolean;
  completedChapterCount: number;
  progressRatio: number;
  lastPlayedChapterId: string | null;
};

export type ChapterProgress = {
  chapterId: string;
  audiobookId: string;
  positionSeconds: number;
  durationSeconds: number | null;
  completed: boolean;
  updatedAt: number;
};

export type Chapter = {
  id: string;
  audiobookId: string;
  position: number;
  title: string;
  audioAssetId: string | null;
  durationSeconds: number | null;
  sizeBytes: number | null;
  container: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  channels: number | null;
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
