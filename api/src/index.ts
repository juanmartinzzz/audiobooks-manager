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
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
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
      LEFT JOIN chapters ch ON ch.audiobook_id = a.id
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
      LEFT JOIN assets a ON a.id = ch.audio_asset_id
      WHERE ch.audiobook_id = ?
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
      WHERE id = ?`,
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
  await c.env.DB.prepare("DELETE FROM audiobooks WHERE id = ?").bind(existing.id).run();
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

app.patch("/api/chapters/:id", async (c) => {
  const existing = await loadChapter(c.env.DB, c.req.param("id"));
  if (!existing) return c.json({ error: "Chapter not found" }, 404);

  const body = await readJson<Partial<CreateChapterInput>>(c.req.raw);
  const title = body.title === undefined ? existing.title : requiredText(body.title, "title");
  const position =
    body.position === undefined ? existing.position : requiredPositiveInt(body.position, "position");
  const now = Date.now();

  await c.env.DB.prepare(
    `UPDATE chapters SET title = ?, position = ?, updated_at = ? WHERE id = ?`,
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
  await c.env.DB.prepare("DELETE FROM chapters WHERE id = ?").bind(existing.id).run();
  await touchAudiobook(c.env.DB, existing.audiobookId, Date.now());
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

async function loadAudiobook(db: D1Database, id: string): Promise<Audiobook | null> {
  const row = await db
    .prepare(
      `SELECT
          a.id, a.title, a.subtitle, a.author, a.narrator,
          a.series_title, a.series_index, a.description,
          a.created_at, a.updated_at,
          COUNT(ch.id) AS chapter_count
        FROM audiobooks a
        LEFT JOIN chapters ch ON ch.audiobook_id = a.id
        WHERE a.id = ?
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
        LEFT JOIN assets a ON a.id = ch.audio_asset_id
        WHERE ch.id = ?`,
    )
    .bind(id)
    .first<ChapterRecord>();
  return row ? mapChapter(row) : null;
}

async function nextChapterPosition(db: D1Database, audiobookId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COALESCE(MAX(position), 0) AS max_position FROM chapters WHERE audiobook_id = ?`)
    .bind(audiobookId)
    .first<{ max_position: number }>();
  return (row?.max_position ?? 0) + 1;
}

async function touchAudiobook(db: D1Database, id: string, now: number): Promise<void> {
  await db.prepare(`UPDATE audiobooks SET updated_at = ? WHERE id = ?`).bind(now, id).run();
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
