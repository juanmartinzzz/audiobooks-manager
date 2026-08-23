import { Hono } from "hono";
import { cors } from "hono/cors";
import type {
  Audiobook,
  AudiobookRecord,
  Chapter,
  ChapterRecord,
  CreateAudiobookInput,
  CreateChapterInput,
} from "./types";

const DIRECT_PUT_MAX_BYTES = 99 * 1024 * 1024;
const MAX_AUDIO_BYTES = 512 * 1024 * 1024;
const MAX_PART_BYTES = 16 * 1024 * 1024;

type AppEnv = { Bindings: Cloudflare.Env };

const app = new Hono<AppEnv>();

const localOrigins = ["http://localhost:27183", "http://127.0.0.1:27183"];
const deployedWebOrigin =
  /^https:\/\/audiobooks-manager-web\.[a-z0-9-]+\.workers\.dev$/;

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return localOrigins[0];
      if (localOrigins.includes(origin) || deployedWebOrigin.test(origin)) {
        return origin;
      }
      return localOrigins[0];
    },
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "X-Chapter-Title",
      "X-Original-Filename",
      "X-Chapter-Position",
      "X-R2-Key",
      "X-Upload-Id",
      "X-Part-Number",
    ],
  }),
);

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/audiobooks", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT
        a.id, a.title, a.subtitle, a.author, a.narrator,
        a.series_title, a.series_index, a.description,
        a.created_at, a.updated_at,
        COUNT(ch.id) AS chapter_count
      FROM audiobooks a
      LEFT JOIN chapters ch ON ch.audiobook_id = a.id AND ch.removed_at IS NULL
      WHERE a.removed_at IS NULL
      GROUP BY a.id
      ORDER BY a.updated_at DESC`,
  ).all<AudiobookRecord & { chapter_count: number }>();

  return c.json({ audiobooks: results.map(mapAudiobook) });
});

app.post("/api/audiobooks", async (c) => {
  const body = await readJson<CreateAudiobookInput>(c.req.raw);
  const title = requiredText(body.title, "title");
  const id = crypto.randomUUID();
  const now = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO audiobooks (
        id, title, subtitle, author, narrator,
        series_title, series_index, description, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      title,
      optionalText(body.subtitle),
      optionalText(body.author),
      optionalText(body.narrator),
      optionalText(body.seriesTitle),
      optionalInt(body.seriesIndex),
      optionalText(body.description),
      now,
      now,
    )
    .run();

  const audiobook = await loadAudiobook(c.env.DB, id);
  return c.json({ audiobook }, 201);
});

app.get("/api/audiobooks/:id", async (c) => {
  const audiobook = await loadAudiobook(c.env.DB, c.req.param("id"));
  if (!audiobook) return c.json({ error: "Audiobook not found" }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT
        ch.id, ch.audiobook_id, ch.position, ch.title, ch.audio_asset_id,
        ch.created_at, ch.updated_at,
        a.duration_seconds, a.size_bytes
      FROM chapters ch
      LEFT JOIN assets a ON a.id = ch.audio_asset_id AND a.removed_at IS NULL
      WHERE ch.audiobook_id = ? AND ch.removed_at IS NULL
      ORDER BY ch.position ASC`,
  )
    .bind(audiobook.id)
    .all<ChapterRecord>();

  return c.json({ audiobook, chapters: results.map(mapChapter) });
});

app.patch("/api/audiobooks/:id", async (c) => {
  const existing = await loadAudiobook(c.env.DB, c.req.param("id"));
  if (!existing) return c.json({ error: "Audiobook not found" }, 404);

  const body = await readJson<Partial<CreateAudiobookInput>>(c.req.raw);
  const title = body.title === undefined ? existing.title : requiredText(body.title, "title");
  const now = Date.now();

  await c.env.DB.prepare(
    `UPDATE audiobooks SET
        title = ?, subtitle = ?, author = ?, narrator = ?,
        series_title = ?, series_index = ?, description = ?, updated_at = ?
      WHERE id = ? AND removed_at IS NULL`,
  )
    .bind(
      title,
      body.subtitle === undefined ? existing.subtitle : optionalText(body.subtitle),
      body.author === undefined ? existing.author : optionalText(body.author),
      body.narrator === undefined ? existing.narrator : optionalText(body.narrator),
      body.seriesTitle === undefined ? existing.seriesTitle : optionalText(body.seriesTitle),
      body.seriesIndex === undefined ? existing.seriesIndex : optionalInt(body.seriesIndex),
      body.description === undefined ? existing.description : optionalText(body.description),
      now,
      existing.id,
    )
    .run();

  const audiobook = await loadAudiobook(c.env.DB, existing.id);
  return c.json({ audiobook });
});

app.delete("/api/audiobooks/:id", async (c) => {
  const existing = await loadAudiobook(c.env.DB, c.req.param("id"));
  if (!existing) return c.json({ error: "Audiobook not found" }, 404);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE audiobooks SET removed_at = ?, updated_at = ? WHERE id = ? AND removed_at IS NULL`,
    ).bind(now, now, existing.id),
    c.env.DB.prepare(
      `UPDATE chapters SET removed_at = ?, updated_at = ? WHERE audiobook_id = ? AND removed_at IS NULL`,
    ).bind(now, now, existing.id),
    c.env.DB.prepare(
      `UPDATE assets SET removed_at = ?, updated_at = ? WHERE audiobook_id = ? AND removed_at IS NULL`,
    ).bind(now, now, existing.id),
    c.env.DB.prepare(
      `UPDATE playback_progress SET removed_at = ?, updated_at = ?
        WHERE audiobook_id = ? AND removed_at IS NULL`,
    ).bind(now, now, existing.id),
  ]);
  return c.json({ ok: true });
});

app.post("/api/audiobooks/:id/chapters", async (c) => {
  const audiobook = await loadAudiobook(c.env.DB, c.req.param("id"));
  if (!audiobook) return c.json({ error: "Audiobook not found" }, 404);

  const body = await readJson<CreateChapterInput>(c.req.raw);
  const title = requiredText(body.title, "title");
  const nextPosition = await nextChapterPosition(c.env.DB, audiobook.id);
  const position = body.position === undefined ? nextPosition : requiredPositiveInt(body.position, "position");
  const id = crypto.randomUUID();
  const now = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO chapters (id, audiobook_id, position, title, audio_asset_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?)`,
  )
    .bind(id, audiobook.id, position, title, now, now)
    .run();

  await touchAudiobook(c.env.DB, audiobook.id, now);
  const chapter = await loadChapter(c.env.DB, id);
  return c.json({ chapter }, 201);
});

app.put("/api/audiobooks/:id/chapters/audio", async (c) => {
  const audiobook = await loadAudiobook(c.env.DB, c.req.param("id"));
  if (!audiobook) return c.json({ error: "Audiobook not found" }, 404);

  const title = requiredText(decodeHeader(c.req.header("X-Chapter-Title")), "title");
  const originalFilename = optionalText(decodeHeader(c.req.header("X-Original-Filename")));
  const requestedPosition = optionalPositiveInt(c.req.header("X-Chapter-Position"));
  const contentType = normalizeContentType(c.req.header("Content-Type"));
  if (!isAudioContentType(contentType)) {
    throw new HttpError("File must be audio", 400);
  }

  const contentLength = Number(c.req.header("Content-Length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    throw new HttpError("Content-Length is required", 400);
  }
  if (contentLength > DIRECT_PUT_MAX_BYTES) {
    throw new HttpError("Use chunked upload for files over 99 MB", 400);
  }

  const body = c.req.raw.body;
  if (!body) throw new HttpError("Missing file body", 400);

  const assetId = crypto.randomUUID();
  const r2Key = `audiobooks/${audiobook.id}/audio/${assetId}/${safeObjectName(originalFilename)}`;

  const stored = await c.env.AUDIO.put(r2Key, body, {
    httpMetadata: { contentType },
    customMetadata: {
      audiobookId: audiobook.id,
      originalFilename: originalFilename ?? "",
    },
  });

  const chapter = await commitChapterAudio(c.env.DB, c.env.AUDIO, {
    audiobookId: audiobook.id,
    assetId,
    r2Key,
    title,
    contentType,
    sizeBytes: stored.size || contentLength,
    originalFilename,
    requestedPosition,
  });
  return c.json({ chapter }, 201);
});

app.post("/api/audiobooks/:id/uploads", async (c) => {
  const audiobook = await loadAudiobook(c.env.DB, c.req.param("id"));
  if (!audiobook) return c.json({ error: "Audiobook not found" }, 404);

  const body = await readJson<{ filename?: string; contentType?: string }>(c.req.raw);
  const originalFilename = optionalText(body.filename);
  const contentType = normalizeContentType(body.contentType);
  if (!isAudioContentType(contentType)) {
    throw new HttpError("File must be audio", 400);
  }

  const assetId = crypto.randomUUID();
  const r2Key = `audiobooks/${audiobook.id}/audio/${assetId}/${safeObjectName(originalFilename)}`;
  const multipart = await c.env.AUDIO.createMultipartUpload(r2Key, {
    httpMetadata: { contentType },
    customMetadata: {
      audiobookId: audiobook.id,
      originalFilename: originalFilename ?? "",
    },
  });

  return c.json({ key: multipart.key, uploadId: multipart.uploadId, assetId }, 201);
});

app.put("/api/audiobooks/:id/uploads/parts", async (c) => {
  const audiobook = await loadAudiobook(c.env.DB, c.req.param("id"));
  if (!audiobook) return c.json({ error: "Audiobook not found" }, 404);

  const key = requiredText(decodeHeader(c.req.header("X-R2-Key")), "key");
  const uploadId = requiredText(decodeHeader(c.req.header("X-Upload-Id")), "uploadId");
  const partNumber = requiredPositiveInt(Number(c.req.header("X-Part-Number")), "partNumber");
  if (partNumber > 10_000) throw new HttpError("Too many parts", 400);
  requireOwnedUploadKey(audiobook.id, key);

  const contentLength = Number(c.req.header("Content-Length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    throw new HttpError("Content-Length is required", 400);
  }
  if (contentLength > MAX_PART_BYTES) {
    throw new HttpError("Each chunk must be 16 MB or smaller", 400);
  }

  const body = c.req.raw.body;
  if (!body) throw new HttpError("Missing file body", 400);

  const multipart = c.env.AUDIO.resumeMultipartUpload(key, uploadId);
  const part = await multipart.uploadPart(partNumber, body);
  return c.json({ partNumber: part.partNumber, etag: part.etag });
});

app.post("/api/audiobooks/:id/uploads/complete", async (c) => {
  const audiobook = await loadAudiobook(c.env.DB, c.req.param("id"));
  if (!audiobook) return c.json({ error: "Audiobook not found" }, 404);

  const body = await readJson<{
    key?: string;
    uploadId?: string;
    assetId?: string;
    title?: string;
    filename?: string;
    contentType?: string;
    sizeBytes?: number;
    position?: number;
    parts?: { partNumber?: number; etag?: string }[];
  }>(c.req.raw);

  const key = requiredText(body.key, "key");
  const uploadId = requiredText(body.uploadId, "uploadId");
  const assetId = requiredUuid(body.assetId, "assetId");
  const title = requiredText(body.title, "title");
  const originalFilename = optionalText(body.filename);
  const contentType = normalizeContentType(body.contentType);
  if (!isAudioContentType(contentType)) {
    throw new HttpError("File must be audio", 400);
  }
  requireOwnedUploadKey(audiobook.id, key, assetId);

  if (typeof body.sizeBytes !== "number" || !Number.isFinite(body.sizeBytes) || body.sizeBytes <= 0) {
    throw new HttpError("sizeBytes must be a positive number", 400);
  }
  if (body.sizeBytes > MAX_AUDIO_BYTES) {
    throw new HttpError("Audio files must be under 512 MB", 400);
  }

  const parts = requiredParts(body.parts);
  const multipart = c.env.AUDIO.resumeMultipartUpload(key, uploadId);
  let stored: R2Object;
  try {
    stored = await multipart.complete(parts);
  } catch (err) {
    await multipart.abort().catch(() => undefined);
    throw err;
  }

  const chapter = await commitChapterAudio(c.env.DB, c.env.AUDIO, {
    audiobookId: audiobook.id,
    assetId,
    r2Key: key,
    title,
    contentType,
    sizeBytes: stored.size || body.sizeBytes,
    originalFilename,
    requestedPosition: body.position === undefined ? undefined : requiredPositiveInt(body.position, "position"),
  });
  return c.json({ chapter }, 201);
});

app.delete("/api/audiobooks/:id/uploads", async (c) => {
  const audiobook = await loadAudiobook(c.env.DB, c.req.param("id"));
  if (!audiobook) return c.json({ error: "Audiobook not found" }, 404);

  const body = await readJson<{ key?: string; uploadId?: string }>(c.req.raw);
  const key = requiredText(body.key, "key");
  const uploadId = requiredText(body.uploadId, "uploadId");
  requireOwnedUploadKey(audiobook.id, key);

  await c.env.AUDIO.resumeMultipartUpload(key, uploadId).abort();
  return c.json({ ok: true });
});

app.patch("/api/chapters/:id", async (c) => {
  const existing = await loadChapter(c.env.DB, c.req.param("id"));
  if (!existing) return c.json({ error: "Chapter not found" }, 404);

  const body = await readJson<Partial<CreateChapterInput>>(c.req.raw);
  const title = body.title === undefined ? existing.title : requiredText(body.title, "title");
  const position =
    body.position === undefined ? existing.position : requiredPositiveInt(body.position, "position");
  const now = Date.now();

  await c.env.DB.prepare(
    `UPDATE chapters SET title = ?, position = ?, updated_at = ? WHERE id = ? AND removed_at IS NULL`,
  )
    .bind(title, position, now, existing.id)
    .run();

  await touchAudiobook(c.env.DB, existing.audiobookId, now);
  const chapter = await loadChapter(c.env.DB, existing.id);
  return c.json({ chapter });
});

app.delete("/api/chapters/:id", async (c) => {
  const existing = await loadChapter(c.env.DB, c.req.param("id"));
  if (!existing) return c.json({ error: "Chapter not found" }, 404);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE chapters SET removed_at = ?, updated_at = ? WHERE id = ? AND removed_at IS NULL`,
    ).bind(now, now, existing.id),
    c.env.DB.prepare(
      `UPDATE playback_progress SET removed_at = ?, updated_at = ?
        WHERE chapter_id = ? AND removed_at IS NULL`,
    ).bind(now, now, existing.id),
  ]);
  await touchAudiobook(c.env.DB, existing.audiobookId, now);
  return c.json({ ok: true });
});

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;

class HttpError extends Error {
  status: 400 | 404 | 422;
  constructor(message: string, status: 400 | 404 | 422) {
    super(message);
    this.status = status;
  }
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError("Invalid JSON body", 400);
  }
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(`${field} is required`, 400);
  }
  return value.trim();
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new HttpError("Invalid text field", 400);
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function optionalInt(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new HttpError("Invalid integer field", 400);
  }
  return value;
}

function requiredPositiveInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new HttpError(`${field} must be a positive integer`, 400);
  }
  return value;
}

function requiredUuid(value: unknown, field: string): string {
  const text = requiredText(value, field);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
    throw new HttpError(`${field} must be a UUID`, 400);
  }
  return text;
}

function requiredParts(value: unknown): R2UploadedPart[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError("parts are required", 400);
  }
  const parts = value.map((part, index) => {
    if (typeof part !== "object" || part === null) {
      throw new HttpError(`parts[${index}] is invalid`, 400);
    }
    const record = part as { partNumber?: unknown; etag?: unknown };
    return {
      partNumber: requiredPositiveInt(record.partNumber, "partNumber"),
      etag: requiredText(record.etag, "etag"),
    };
  });
  parts.sort((a, b) => a.partNumber - b.partNumber);
  return parts;
}

function requireOwnedUploadKey(audiobookId: string, key: string, assetId?: string): void {
  if (key.includes("..") || key.startsWith("/") || key.includes("//")) {
    throw new HttpError("Invalid key", 400);
  }
  const prefix = assetId
    ? `audiobooks/${audiobookId}/audio/${assetId}/`
    : `audiobooks/${audiobookId}/audio/`;
  if (!key.startsWith(prefix)) {
    throw new HttpError("Invalid key", 400);
  }
}

function optionalPositiveInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return requiredPositiveInt(parsed, "position");
}

function decodeHeader(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeContentType(value: string | undefined): string {
  const type = (value ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
  return type.length > 0 ? type : "application/octet-stream";
}

function isAudioContentType(type: string): boolean {
  return type.startsWith("audio/") || type === "application/octet-stream" || type === "video/mp4";
}

function safeObjectName(filename: string | null): string {
  const base = (filename ?? "audio").split(/[/\\]/).pop() ?? "audio";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120);
  return cleaned.length > 0 ? cleaned : "audio";
}

function isUniqueConstraint(err: unknown): boolean {
  return err instanceof Error && /unique constraint/i.test(err.message);
}

async function commitChapterAudio(
  db: D1Database,
  bucket: R2Bucket,
  input: {
    audiobookId: string;
    assetId: string;
    r2Key: string;
    title: string;
    contentType: string;
    sizeBytes: number;
    originalFilename: string | null;
    requestedPosition: number | undefined;
  },
): Promise<Chapter> {
  const chapterId = crypto.randomUUID();
  const now = Date.now();

  try {
    const position = input.requestedPosition ?? (await nextChapterPosition(db, input.audiobookId));
    await insertChapterWithAudio(db, {
      chapterId,
      assetId: input.assetId,
      audiobookId: input.audiobookId,
      position,
      title: input.title,
      r2Key: input.r2Key,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      originalFilename: input.originalFilename,
      now,
    });
  } catch (err) {
    const retryable = input.requestedPosition === undefined && isUniqueConstraint(err);
    if (!retryable) {
      await bucket.delete(input.r2Key);
      throw err;
    }
    try {
      const position = await nextChapterPosition(db, input.audiobookId);
      await insertChapterWithAudio(db, {
        chapterId,
        assetId: input.assetId,
        audiobookId: input.audiobookId,
        position,
        title: input.title,
        r2Key: input.r2Key,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        originalFilename: input.originalFilename,
        now,
      });
    } catch (retryErr) {
      await bucket.delete(input.r2Key);
      throw retryErr;
    }
  }

  const chapter = await loadChapter(db, chapterId);
  if (!chapter) throw new HttpError("Chapter not found", 404);
  return chapter;
}

async function insertChapterWithAudio(
  db: D1Database,
  input: {
    chapterId: string;
    assetId: string;
    audiobookId: string;
    position: number;
    title: string;
    r2Key: string;
    contentType: string;
    sizeBytes: number;
    originalFilename: string | null;
    now: number;
  },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO assets (
            id, audiobook_id, r2_key, kind, content_type, size_bytes, duration_seconds,
            original_filename, created_at, updated_at
          ) VALUES (?, ?, ?, 'audio', ?, ?, NULL, ?, ?, ?)`,
      )
      .bind(
        input.assetId,
        input.audiobookId,
        input.r2Key,
        input.contentType,
        input.sizeBytes,
        input.originalFilename,
        input.now,
        input.now,
      ),
    db
      .prepare(
        `INSERT INTO chapters (
            id, audiobook_id, position, title, audio_asset_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.chapterId,
        input.audiobookId,
        input.position,
        input.title,
        input.assetId,
        input.now,
        input.now,
      ),
    db
      .prepare(`UPDATE audiobooks SET updated_at = ? WHERE id = ? AND removed_at IS NULL`)
      .bind(input.now, input.audiobookId),
  ]);
}

async function loadAudiobook(db: D1Database, id: string): Promise<Audiobook | null> {
  const row = await db
    .prepare(
      `SELECT
          a.id, a.title, a.subtitle, a.author, a.narrator,
          a.series_title, a.series_index, a.description,
          a.created_at, a.updated_at,
          COUNT(ch.id) AS chapter_count
        FROM audiobooks a
        LEFT JOIN chapters ch ON ch.audiobook_id = a.id AND ch.removed_at IS NULL
        WHERE a.id = ? AND a.removed_at IS NULL
        GROUP BY a.id`,
    )
    .bind(id)
    .first<AudiobookRecord & { chapter_count: number }>();
  return row ? mapAudiobook(row) : null;
}

async function loadChapter(db: D1Database, id: string): Promise<Chapter | null> {
  const row = await db
    .prepare(
      `SELECT
          ch.id, ch.audiobook_id, ch.position, ch.title, ch.audio_asset_id,
          ch.created_at, ch.updated_at,
          a.duration_seconds, a.size_bytes
        FROM chapters ch
        LEFT JOIN assets a ON a.id = ch.audio_asset_id AND a.removed_at IS NULL
        WHERE ch.id = ? AND ch.removed_at IS NULL`,
    )
    .bind(id)
    .first<ChapterRecord>();
  return row ? mapChapter(row) : null;
}

async function nextChapterPosition(db: D1Database, audiobookId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(MAX(position), 0) AS max_position
        FROM chapters WHERE audiobook_id = ? AND removed_at IS NULL`,
    )
    .bind(audiobookId)
    .first<{ max_position: number }>();
  return (row?.max_position ?? 0) + 1;
}

async function touchAudiobook(db: D1Database, id: string, now: number): Promise<void> {
  await db
    .prepare(`UPDATE audiobooks SET updated_at = ? WHERE id = ? AND removed_at IS NULL`)
    .bind(now, id)
    .run();
}

function mapAudiobook(row: AudiobookRecord & { chapter_count: number }): Audiobook {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    author: row.author,
    narrator: row.narrator,
    seriesTitle: row.series_title,
    seriesIndex: row.series_index,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    chapterCount: Number(row.chapter_count),
  };
}

function mapChapter(row: ChapterRecord): Chapter {
  return {
    id: row.id,
    audiobookId: row.audiobook_id,
    position: row.position,
    title: row.title,
    audioAssetId: row.audio_asset_id,
    durationSeconds: row.duration_seconds,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
