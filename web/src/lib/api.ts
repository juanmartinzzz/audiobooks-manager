import type { Audiobook, AudiobookDraft, AudiobookStatus, Chapter, ChapterProgress } from "../types";
import { durationFromAudioFile } from "./audioDuration";

// Local `npm run dev` and production builds both call the production API.
const base = import.meta.env.VITE_API_URL ?? "";

export const DIRECT_PUT_MAX_BYTES = 99 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 512 * 1024 * 1024;
const PART_SIZE = 10 * 1024 * 1024;

type AudiobookListResponse = { audiobooks: Audiobook[] };
type AudiobookResponse = { audiobook: Audiobook };
type AudiobookDetailResponse = { audiobook: Audiobook; chapters: Chapter[]; progress: ChapterProgress[] };
type ChapterResponse = { chapter: Chapter };
type ChapterProgressResponse = { progress: ChapterProgress };

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

export function audiobookCoverUrl(id: string, updatedAt?: number): string {
  const version = updatedAt != null ? `?v=${updatedAt}` : "";
  return `${base}/api/audiobooks/${id}/cover${version}`;
}

export function chapterAudioUrl(id: string): string {
  return `${base}/api/chapters/${id}/audio`;
}

export function listAudiobooks() {
  return request<AudiobookListResponse>("/api/audiobooks");
}

export function getAudiobook(id: string) {
  return request<AudiobookDetailResponse>(`/api/audiobooks/${id}`);
}

export function putChapterProgress(
  chapterId: string,
  body: {
    positionSeconds: number;
    durationSeconds?: number | null;
    completed?: boolean;
  },
) {
  return request<ChapterProgressResponse>(`/api/chapters/${chapterId}/progress`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
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

export function updateAudiobookStatus(id: string, status: AudiobookStatus) {
  return request<AudiobookResponse>(`/api/audiobooks/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
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

export async function uploadChapterAudio(
  audiobookId: string,
  input: {
    file: File;
    title: string;
    position?: number;
    onProgress?: (ratio: number) => void;
  },
): Promise<ChapterResponse> {
  if (input.file.size > MAX_AUDIO_BYTES) {
    return Promise.reject(new ApiError("Audio files must be under 512 MB", 400));
  }
  const durationSeconds = await durationFromAudioFile(input.file);
  if (input.file.size <= DIRECT_PUT_MAX_BYTES) {
    return uploadDirect(audiobookId, { ...input, durationSeconds });
  }
  return uploadMultipart(audiobookId, { ...input, durationSeconds });
}

function uploadDirect(
  audiobookId: string,
  input: {
    file: File;
    title: string;
    position?: number;
    durationSeconds: number | null;
    onProgress?: (ratio: number) => void;
  },
): Promise<ChapterResponse> {
  return xhrJson<ChapterResponse>("PUT", `/api/audiobooks/${audiobookId}/chapters/audio`, {
    body: input.file,
    headers: {
      "Content-Type": input.file.type || "application/octet-stream",
      "X-Chapter-Title": encodeURIComponent(input.title),
      "X-Original-Filename": encodeURIComponent(input.file.name),
      ...(input.position !== undefined ? { "X-Chapter-Position": String(input.position) } : {}),
      ...(input.durationSeconds != null ? { "X-Duration-Seconds": String(input.durationSeconds) } : {}),
    },
    onProgress: input.onProgress,
  });
}

async function uploadMultipart(
  audiobookId: string,
  input: {
    file: File;
    title: string;
    position?: number;
    durationSeconds: number | null;
    onProgress?: (ratio: number) => void;
  },
): Promise<ChapterResponse> {
  const session = await request<{ key: string; uploadId: string; assetId: string }>(
    `/api/audiobooks/${audiobookId}/uploads`,
    {
      method: "POST",
      body: JSON.stringify({
        filename: input.file.name,
        contentType: input.file.type || "application/octet-stream",
      }),
    },
  );

  const partCount = Math.ceil(input.file.size / PART_SIZE);
  const parts: { partNumber: number; etag: string }[] = [];

  try {
    for (let index = 0; index < partCount; index += 1) {
      const start = index * PART_SIZE;
      const chunk = input.file.slice(start, start + PART_SIZE);
      const part = await xhrJson<{ partNumber: number; etag: string }>(
        "PUT",
        `/api/audiobooks/${audiobookId}/uploads/parts`,
        {
          body: chunk,
          headers: {
            "Content-Type": "application/octet-stream",
            "X-R2-Key": encodeURIComponent(session.key),
            "X-Upload-Id": encodeURIComponent(session.uploadId),
            "X-Part-Number": String(index + 1),
          },
          onProgress: (ratio) => {
            const bytes = start + ratio * chunk.size;
            input.onProgress?.(bytes / input.file.size);
          },
        },
      );
      parts.push(part);
    }

    const result = await request<ChapterResponse>(`/api/audiobooks/${audiobookId}/uploads/complete`, {
      method: "POST",
      body: JSON.stringify({
        key: session.key,
        uploadId: session.uploadId,
        assetId: session.assetId,
        title: input.title,
        filename: input.file.name,
        contentType: input.file.type || "application/octet-stream",
        sizeBytes: input.file.size,
        position: input.position,
        durationSeconds: input.durationSeconds,
        parts,
      }),
    });
    input.onProgress?.(1);
    return result;
  } catch (err) {
    await request<{ ok: true }>(`/api/audiobooks/${audiobookId}/uploads`, {
      method: "DELETE",
      body: JSON.stringify({ key: session.key, uploadId: session.uploadId }),
    }).catch(() => undefined);
    throw err;
  }
}

function xhrJson<T>(
  method: string,
  path: string,
  input: {
    body: Blob;
    headers: Record<string, string>;
    onProgress?: (ratio: number) => void;
  },
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `${base}${path}`);
    for (const [name, value] of Object.entries(input.headers)) {
      xhr.setRequestHeader(name, value);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) input.onProgress?.(event.loaded / event.total);
    };

    xhr.onload = () => {
      const payload = parseJson<{ error?: string } & T>(xhr.responseText);
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError(payload.error ?? `Request failed (${xhr.status})`, xhr.status));
        return;
      }
      resolve(payload as T);
    };

    xhr.onerror = () => reject(new ApiError("Upload failed", 0));
    xhr.onabort = () => reject(new ApiError("Upload cancelled", 0));
    xhr.send(input.body);
  });
}

function parseJson<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return {} as T;
  }
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
