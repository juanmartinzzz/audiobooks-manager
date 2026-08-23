import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Play, Plus, Settings, SkipBack, SkipForward, Trash2 } from "lucide-react";
import { ChapterBulkUpload } from "../components/ChapterBulkUpload";
import { Modal } from "../components/Modal";
import { PillButton } from "../components/PillButton";
import { createChapter, deleteAudiobook, deleteChapter, getAudiobook } from "../lib/api";
import { toRoman } from "../lib/roman";
import type { Audiobook, Chapter } from "../types";

export function AudiobookPage() {
  const { id } = useParams();
  if (!id) return null;
  return <AudiobookPageInner key={id} id={id} />;
}

function AudiobookPageInner({ id }: { id: string }) {
  const navigate = useNavigate();
  const [audiobook, setAudiobook] = useState<Audiobook | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chapterTitle, setChapterTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  async function refresh(audiobookId: string) {
    const data = await getAudiobook(audiobookId);
    setAudiobook(data.audiobook);
    setChapters(data.chapters);
  }

  useEffect(() => {
    let cancelled = false;
    getAudiobook(id)
      .then((data) => {
        if (cancelled) return;
        setAudiobook(data.audiobook);
        setChapters(data.chapters);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load audiobook");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const active = chapters.find((chapter) => chapter.id === activeId) ?? null;

  async function onAddChapter() {
    if (!id || chapterTitle.trim().length === 0) return;
    setAdding(true);
    setError(null);
    try {
      await createChapter(id, chapterTitle);
      setChapterTitle("");
      await refresh(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add chapter");
    } finally {
      setAdding(false);
    }
  }

  async function onDeleteChapter(chapterId: string) {
    if (!id) return;
    await deleteChapter(chapterId);
    if (activeId === chapterId) setActiveId(null);
    await refresh(id);
  }

  async function onDeleteBook() {
    if (!id || !audiobook) return;
    const confirmed = window.confirm(`Delete “${audiobook.title}”?`);
    if (!confirmed) return;
    await deleteAudiobook(id);
    navigate("/");
  }

  if (loading) {
    return (
      <main className="wrap">
        <p className="muted">Opening audiobook…</p>
      </main>
    );
  }

  if (!audiobook) {
    return (
      <main className="wrap">
        <p className="banner">{error ?? "Audiobook not found"}</p>
        <Link className="text-link" to="/">
          Back to library
        </Link>
      </main>
    );
  }

  const eyebrow = audiobook.seriesTitle
    ? `${audiobook.seriesTitle}${audiobook.seriesIndex ? ` · ${audiobook.seriesIndex}` : ""}`
    : "Standalone";

  return (
    <>
      <header className="top">
        <div className="wrap header-row">
          <div>
            <Link className="back-link" to="/">
              <ArrowLeft size={16} />
              Library
            </Link>
            <p className="brand-eyebrow">{eyebrow}</p>
            <h1 className="brand-title">{audiobook.title}</h1>
            <p className="brand-sub">
              {audiobook.subtitle ??
                (audiobook.author
                  ? `${audiobook.author}${audiobook.narrator ? ` · narrated by ${audiobook.narrator}` : ""}`
                  : "Drop audio files to create chapters, or add a title without a file.")}
            </p>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className="icon-btn"
              aria-label="Settings"
              title="Listening settings"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings size={19} />
            </button>
          </div>
        </div>
      </header>

      <main className="wrap">
        {error ? <p className="banner">{error}</p> : null}

        <ChapterBulkUpload
          audiobookId={id}
          nextPosition={(chapters.at(-1)?.position ?? 0) + 1}
          onUploaded={() => refresh(id)}
        />

        <form
          className="add-chapter"
          onSubmit={(event) => {
            event.preventDefault();
            void onAddChapter();
          }}
        >
          <input
            placeholder="Chapter title only (no audio yet)"
            value={chapterTitle}
            onChange={(event) => setChapterTitle(event.target.value)}
          />
          <PillButton type="submit" disabled={adding || chapterTitle.trim().length === 0}>
            <Plus size={16} />
            Add empty chapter
          </PillButton>
        </form>

        <p className="section-label">
          {chapters.length === 0 ? "Chapters" : `${chapters.length} chapters`}
        </p>

        {chapters.length === 0 ? (
          <p className="muted">No chapters yet. Drop audio files above, or add a title without a file.</p>
        ) : (
          <div className="grid">
            {chapters.map((chapter) => (
              <motion.div
                key={chapter.id}
                className={`chapter-card ${activeId === chapter.id ? "active" : ""}`}
                data-roman={toRoman(chapter.position)}
                role="button"
                tabIndex={0}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => setActiveId(chapter.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setActiveId(chapter.id);
                  }
                }}
              >
                <span className="chapter-num mono">Chapter {String(chapter.position).padStart(2, "0")}</span>
                <h3 className="chapter-title">{chapter.title}</h3>
                <div className="chapter-meta">
                  <span className="dur">{chapter.audioAssetId ? "Audio ready" : "No audio yet"}</span>
                  <button
                    type="button"
                    className="chapter-play"
                    onClick={(event) => {
                      event.stopPropagation();
                      void onDeleteChapter(chapter.id);
                    }}
                    aria-label={`Delete ${chapter.title}`}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {active ? (
          <section className="now-playing" aria-live="polite">
            <div className="np-head">
              <div>
                <p className="eyebrow">Now playing</p>
                <h2>{active.title}</h2>
              </div>
            </div>
            <div className="transport">
              <button type="button" className="transport-btn" disabled title="Skip back">
                <SkipBack size={18} />
              </button>
              <button type="button" className="transport-btn play-main" disabled aria-label="Play">
                <Play size={22} />
              </button>
              <button type="button" className="transport-btn" disabled title="Skip forward">
                <SkipForward size={18} />
              </button>
              <div className="seek-row">
                <span className="time-mono">0:00</span>
                <input type="range" min={0} max={100} value={0} readOnly />
                <span className="time-mono end">—</span>
              </div>
            </div>
            <p className="muted">Playback waits until this chapter has an audio file in the bucket.</p>
          </section>
        ) : null}
      </main>

      {settingsOpen ? (
        <Modal title="Journey settings" onClose={() => setSettingsOpen(false)}>
          <p className="muted">
            Segment length, skip amounts, and playback prefs will persist after the schema is approved.
            Defaults match the sample: 5 minute segments, 15s back, 30s forward.
          </p>
          <div className="modal-actions">
            <PillButton variant="ghost" onClick={() => void onDeleteBook()}>
              Delete audiobook
            </PillButton>
            <PillButton onClick={() => setSettingsOpen(false)}>Done</PillButton>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
