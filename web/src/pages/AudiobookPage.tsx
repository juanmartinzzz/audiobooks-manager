import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, CheckCircle2, Play, Plus, Settings, Trash2 } from "lucide-react";
import { ChapterBulkUpload } from "../components/ChapterBulkUpload";
import { Modal } from "../components/Modal";
import { NowPlaying } from "../components/NowPlaying";
import { NumericInput } from "../components/interaction/NumericInput";
import { PillButton } from "../components/PillButton";
import {
  createChapter,
  deleteAudiobook,
  deleteChapter,
  getAudiobook,
  audiobookCoverUrl,
  chapterAudioUrl,
  putChapterProgress,
  updateAudiobookStatus,
} from "../lib/api";
import { formatChapterAudioFacts } from "../lib/audioDuration";
import {
  clampPlaybackSettings,
  loadPlaybackPrefs,
  loadPlaybackSettings,
  savePlaybackPrefs,
  savePlaybackSettings,
  type PlaybackPrefs,
  type PlaybackSettings,
} from "../lib/playbackPrefs";
import { isFinished, playedFraction, resumeSeconds } from "../lib/playbackProgress";
import { toRoman } from "../lib/roman";
import type { Audiobook, Chapter, ChapterProgress } from "../types";

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
  const [autoplay, setAutoplay] = useState(false);
  const [resumeAt, setResumeAt] = useState<number | null>(null);
  const [progressByChapter, setProgressByChapter] = useState<Record<string, ChapterProgress>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(loadPlaybackSettings);
  const [prefs, setPrefs] = useState(loadPlaybackPrefs);
  const [statusSaving, setStatusSaving] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRef = useRef(progressByChapter);
  progressRef.current = progressByChapter;

  async function refresh(audiobookId: string) {
    const data = await getAudiobook(audiobookId);
    setAudiobook(data.audiobook);
    setChapters(data.chapters);
    setProgressByChapter(Object.fromEntries((data.progress ?? []).map((item) => [item.chapterId, item])));
  }

  useEffect(() => {
    let cancelled = false;
    getAudiobook(id)
      .then((data) => {
        if (cancelled) return;
        setAudiobook(data.audiobook);
        setChapters(data.chapters);
        setProgressByChapter(Object.fromEntries((data.progress ?? []).map((item) => [item.chapterId, item])));
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

  async function onSetStatus(status: "draft" | "complete") {
    if (!id) return;
    if (status === "complete" && chapters.length === 0) return;
    if (
      status === "complete" &&
      !window.confirm(
        "Mark this book complete? Upload and chapter tools will hide until you reopen it as a draft.",
      )
    ) {
      return;
    }
    setStatusSaving(true);
    setError(null);
    try {
      await updateAudiobookStatus(id, status);
      await refresh(id);
      setSettingsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update audiobook");
    } finally {
      setStatusSaving(false);
    }
  }

  function onPrefsChange(next: PlaybackPrefs) {
    setPrefs(next);
    savePlaybackPrefs(next);
  }

  const onProgress = useCallback(
    (payload: {
      chapterId: string;
      positionSeconds: number;
      durationSeconds: number | null;
      completed: boolean;
    }) => {
      const next: ChapterProgress = {
        chapterId: payload.chapterId,
        audiobookId: id,
        positionSeconds: payload.positionSeconds,
        durationSeconds: payload.durationSeconds,
        completed: payload.completed,
        updatedAt: Date.now(),
      };
      setProgressByChapter((current) => ({ ...current, [payload.chapterId]: next }));
      void putChapterProgress(payload.chapterId, {
        positionSeconds: payload.positionSeconds,
        durationSeconds: payload.durationSeconds,
        completed: payload.completed,
      });
    },
    [id],
  );

  function activateChapter(chapter: Chapter, shouldAutoplay: boolean) {
    const audio = audioRef.current;
    if (activeId === chapter.id) {
      if (shouldAutoplay && chapter.audioAssetId) {
        void audio?.play().catch(() => undefined);
      }
      return;
    }
    if (audio && activeId) {
      audio.pause();
    }
    setResumeAt(resumeSeconds(progressRef.current[chapter.id], chapter.durationSeconds));
    setAutoplay(shouldAutoplay);
    setActiveId(chapter.id);
    if (!audio) return;
    if (!chapter.audioAssetId) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      return;
    }
    const url = chapterAudioUrl(chapter.id);
    if (audio.getAttribute("src") !== url) {
      audio.src = url;
    }
  }

  function closePlayer() {
    audioRef.current?.pause();
    setActiveId(null);
  }

  function onSaveSettings(next: PlaybackSettings) {
    const clamped = clampPlaybackSettings(next);
    setSettings(clamped);
    savePlaybackSettings(clamped);
    setSettingsOpen(false);
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

  const isDraft = audiobook.status === "draft";
  const eyebrow = audiobook.seriesTitle
    ? `${audiobook.seriesTitle}${audiobook.seriesIndex ? ` · ${audiobook.seriesIndex}` : ""}`
    : "Standalone";
  const subtitle =
    audiobook.subtitle ??
    (audiobook.author
      ? `${audiobook.author}${audiobook.narrator ? ` · narrated by ${audiobook.narrator}` : ""}`
      : isDraft
        ? "Drop audio files to create chapters, or add a title without a file."
        : null);

  return (
    <>
      <header className="top">
        <div className="wrap header-row">
          <div className="header-identity">
            {audiobook.hasCover ? (
              <img
                className="book-cover-hero"
                src={audiobookCoverUrl(audiobook.id, audiobook.updatedAt)}
                alt=""
              />
            ) : null}
            <div>
              <Link className="back-link" to="/">
                <ArrowLeft size={16} />
                Library
              </Link>
              <p className="brand-eyebrow">
                {eyebrow}
                {isDraft ? " · Draft" : ""}
              </p>
              <h1 className="brand-title">{audiobook.title}</h1>
              {subtitle ? <p className="brand-sub">{subtitle}</p> : null}
            </div>
          </div>
          <div className="header-actions">
            {isDraft ? (
              <PillButton
                disabled={statusSaving || chapters.length === 0}
                title={
                  chapters.length === 0
                    ? "Add at least one chapter before marking complete"
                    : "Hide upload and chapter tools"
                }
                onClick={() => void onSetStatus("complete")}
              >
                {statusSaving ? "Saving…" : "Mark complete"}
              </PillButton>
            ) : null}
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

        {isDraft ? (
          <>
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
          </>
        ) : null}

        <p className="section-label">
          {chapters.length === 0 ? "Chapters" : `${chapters.length} chapters`}
        </p>

        {chapters.length === 0 ? (
          <p className="muted">
            {isDraft
              ? "No chapters yet. Drop audio files above, or add a title without a file."
              : "No chapters yet."}
          </p>
        ) : (
          <div className="grid">
            {chapters.map((chapter) => {
              const progress = progressByChapter[chapter.id];
              const fraction = playedFraction(progress);
              const finished = isFinished(progress);
              return (
              <motion.div
                key={chapter.id}
                className={`chapter-card ${activeId === chapter.id ? "active" : ""}${finished ? " finished" : ""}`}
                data-roman={toRoman(chapter.position)}
                role="button"
                tabIndex={0}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => activateChapter(chapter, true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    activateChapter(chapter, true);
                  }
                }}
              >
                {finished ? (
                  <span className="finished-badge" title="Finished">
                    <CheckCircle2 size={15} />
                  </span>
                ) : null}
                <span className="chapter-num mono">Chapter {String(chapter.position).padStart(2, "0")}</span>
                <h3 className="chapter-title">{chapter.title}</h3>
                <div className="chapter-meta">
                  <span className="dur">{formatChapterAudioFacts(chapter)}</span>
                  <div className="chapter-card-actions">
                    <button
                      type="button"
                      className="chapter-play"
                      disabled={!chapter.audioAssetId}
                      onClick={(event) => {
                        event.stopPropagation();
                        activateChapter(chapter, true);
                      }}
                      aria-label={
                        chapter.audioAssetId ? `Play ${chapter.title}` : `${chapter.title} has no audio`
                      }
                    >
                      <Play size={12} />
                    </button>
                    {isDraft ? (
                      <button
                        type="button"
                        className="chapter-delete"
                        onClick={(event) => {
                          event.stopPropagation();
                          void onDeleteChapter(chapter.id);
                        }}
                        aria-label={`Delete ${chapter.title}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="progress-sliver" style={{ width: `${(fraction * 100).toFixed(1)}%` }} />
              </motion.div>
              );
            })}
          </div>
        )}

        {active ? (
          <NowPlaying
            audioRef={audioRef}
            chapter={active}
            chapters={chapters}
            settings={settings}
            prefs={prefs}
            autoplay={autoplay}
            resumeSeconds={resumeAt}
            onPrefsChange={onPrefsChange}
            onProgress={onProgress}
            onSelectChapter={(chapterId) => {
              const next = chapters.find((item) => item.id === chapterId);
              if (next) activateChapter(next, true);
            }}
            onClose={closePlayer}
          />
        ) : null}
      </main>
      <audio ref={audioRef} preload="metadata" />

      {settingsOpen ? (
        <JourneySettingsModal
          settings={settings}
          onSave={onSaveSettings}
          onClose={() => setSettingsOpen(false)}
          onDeleteBook={() => void onDeleteBook()}
          onReopenDraft={isDraft ? undefined : () => void onSetStatus("draft")}
          reopening={statusSaving}
        />
      ) : null}
    </>
  );
}

function JourneySettingsModal({
  settings,
  onSave,
  onClose,
  onDeleteBook,
  onReopenDraft,
  reopening,
}: {
  settings: PlaybackSettings;
  onSave: (settings: PlaybackSettings) => void;
  onClose: () => void;
  onDeleteBook: () => void;
  onReopenDraft?: () => void;
  reopening?: boolean;
}) {
  const [draft, setDraft] = useState(settings);

  return (
    <Modal title="Journey settings" onClose={onClose}>
      <div className="settings-stack">
        <NumericInput
          label="Waypoint length"
          help="Minutes per segment along a chapter"
          min={1}
          max={60}
          step={1}
          value={draft.segmentMinutes}
          onChange={(event) => setDraft({ ...draft, segmentMinutes: Number(event.target.value) })}
        />
        <NumericInput
          label="Skip back"
          help="Seconds"
          min={5}
          max={120}
          step={5}
          value={draft.skipBack}
          onChange={(event) => setDraft({ ...draft, skipBack: Number(event.target.value) })}
        />
        <NumericInput
          label="Skip forward"
          help="Seconds"
          min={5}
          max={120}
          step={5}
          value={draft.skipForward}
          onChange={(event) => setDraft({ ...draft, skipForward: Number(event.target.value) })}
        />
      </div>
      <div className="modal-actions">
        <div className="modal-actions-secondary">
          <PillButton variant="ghost" onClick={onDeleteBook}>
            Delete audiobook
          </PillButton>
          {onReopenDraft ? (
            <PillButton variant="ghost" disabled={reopening} onClick={onReopenDraft}>
              {reopening ? "Reopening…" : "Reopen as draft"}
            </PillButton>
          ) : null}
        </div>
        <PillButton onClick={() => onSave(draft)}>Done</PillButton>
      </div>
    </Modal>
  );
}
