import type { Audiobook, AudiobookDraft, Chapter } from "../types";

const base = import.meta.env.VITE_API_URL ?? "";

type AudiobookListResponse = { audiobooks: Audiobook[] };
type AudiobookResponse = { audiobook: Audiobook };
type AudiobookDetailResponse = { audiobook: Audiobook; chapters: Chapter[] };
type ChapterResponse = { chapter: Chapter };

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${base}${path}`, { ...init, headers });
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;

  if (!response.ok) {
    throw new ApiError(payload.error ?? `Request failed (${response.status})`, response.status);
  }

  return payload;
}

export function listAudiobooks() {
  return request<AudiobookListResponse>("/api/audiobooks");
}

export function getAudiobook(id: string) {
  return request<AudiobookDetailResponse>(`/api/audiobooks/${id}`);
}

export function createAudiobook(draft: AudiobookDraft) {
  return request<AudiobookResponse>("/api/audiobooks", {
    method: "POST",
    body: JSON.stringify(toAudiobookPayload(draft)),
  });
}

export function deleteAudiobook(id: string) {
  return request<{ ok: true }>(`/api/audiobooks/${id}`, { method: "DELETE" });
}

export function createChapter(audiobookId: string, title: string) {
  return request<ChapterResponse>(`/api/audiobooks/${audiobookId}/chapters`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export function deleteChapter(id: string) {
  return request<{ ok: true }>(`/api/chapters/${id}`, { method: "DELETE" });
}

function toAudiobookPayload(draft: AudiobookDraft) {
  const seriesIndex = draft.seriesIndex.trim();
  return {
    title: draft.title,
    subtitle: draft.subtitle,
    author: draft.author,
    narrator: draft.narrator,
    seriesTitle: draft.seriesTitle,
    seriesIndex: seriesIndex === "" ? null : Number(seriesIndex),
    description: draft.description,
  };
}
