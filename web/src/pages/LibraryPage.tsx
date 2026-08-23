import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, CheckCircle2, Plus } from "lucide-react";
import { NumericInput } from "../components/interaction/NumericInput";
import { PillSelect } from "../components/interaction/PillSelect";
import { SectionsCard, type SectionsCardSection } from "../components/interaction/SectionsCard";
import { TextArea, TextInput } from "../components/interaction/TextInput";
import { PillButton } from "../components/PillButton";
import { createAudiobook, listAudiobooks, audiobookCoverUrl } from "../lib/api";
import { emptyAudiobookDraft, type Audiobook, type AudiobookDraft } from "../types";

const PLACEMENT_OPTIONS = [
  { value: "standalone", label: "Standalone" },
  { value: "series", label: "Part of a series" },
];

export function LibraryPage() {
  const navigate = useNavigate();
  const [audiobooks, setAudiobooks] = useState<Audiobook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<AudiobookDraft>(emptyAudiobookDraft);
  const [placement, setPlacement] = useState<"standalone" | "series">("standalone");
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setError(null);
    const data = await listAudiobooks();
    setAudiobooks(data.audiobooks);
  }

  useEffect(() => {
    let cancelled = false;
    listAudiobooks()
      .then((data) => {
        if (!cancelled) setAudiobooks(data.audiobooks);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load library");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function openCreate() {
    setError(null);
    setDraft(emptyAudiobookDraft());
    setPlacement("standalone");
    setCreating(true);
  }

  function closeCreate() {
    setCreating(false);
    setDraft(emptyAudiobookDraft());
    setPlacement("standalone");
  }

  async function onCreate() {
    setSaving(true);
    setError(null);
    try {
      const payload =
        placement === "series" ? draft : { ...draft, seriesTitle: "", seriesIndex: "" };
      const { audiobook } = await createAudiobook(payload);
      await refresh();
      closeCreate();
      navigate(`/audiobooks/${audiobook.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create audiobook");
    } finally {
      setSaving(false);
    }
  }

  const formSections: SectionsCardSection[] = [
    {
      id: "identity",
      title: "Identity",
      description: "What readers see first. Title is the only required field.",
      columns: [
        <TextInput
          key="title"
          id="new-audiobook-title"
          label="Title"
          required
          autoFocus
          value={draft.title}
          onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
        />,
        <TextInput
          key="subtitle"
          label="Subtitle"
          help="Shown under the title on the listening page."
          value={draft.subtitle}
          onChange={(event) => setDraft((current) => ({ ...current, subtitle: event.target.value }))}
        />,
      ],
    },
    {
      id: "credits",
      title: "Credits",
      description: "Who wrote it and who reads it. Both can wait.",
      columns: [
        <TextInput
          key="author"
          label="Author"
          value={draft.author}
          onChange={(event) => setDraft((current) => ({ ...current, author: event.target.value }))}
        />,
        <TextInput
          key="narrator"
          label="Narrator"
          value={draft.narrator}
          onChange={(event) => setDraft((current) => ({ ...current, narrator: event.target.value }))}
        />,
      ],
    },
    {
      id: "placement",
      title: "Placement",
      description: "A standalone title, or a numbered book in a series.",
      columnWidths: placement === "series" ? "14rem 1fr 8rem" : undefined,
      columns:
        placement === "series"
          ? [
              <PillSelect
                key="kind"
                label="Kind"
                options={PLACEMENT_OPTIONS}
                value={placement}
                onChange={(value) => setPlacement(value === "series" ? "series" : "standalone")}
              />,
              <TextInput
                key="seriesTitle"
                label="Series"
                value={draft.seriesTitle}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, seriesTitle: event.target.value }))
                }
              />,
              <NumericInput
                key="seriesIndex"
                label="Series index"
                help="1, 2, 3…"
                min={1}
                step={1}
                value={draft.seriesIndex}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, seriesIndex: event.target.value }))
                }
              />,
            ]
          : [
              <PillSelect
                key="kind"
                label="Kind"
                options={PLACEMENT_OPTIONS}
                value={placement}
                onChange={(value) => setPlacement(value === "series" ? "series" : "standalone")}
              />,
            ],
    },
    {
      id: "about",
      title: "About",
      description: "Optional blurb. You can fill this in later.",
      columns: [
        <TextArea
          key="description"
          label="Description"
          rows={3}
          value={draft.description}
          onChange={(event) =>
            setDraft((current) => ({ ...current, description: event.target.value }))
          }
        />,
      ],
    },
  ];

  return (
    <>
      <header className="top">
        <div className="wrap header-row">
          <div>
            <p className="brand-eyebrow">Audiobooks Manager</p>
            <h1 className="brand-title">Library</h1>
            <p className="brand-sub">Create a book, then open it to add chapters from audio files.</p>
          </div>
          {creating ? (
            <PillButton variant="ghost" onClick={closeCreate}>
              Cancel
            </PillButton>
          ) : (
            <PillButton onClick={openCreate}>
              <Plus size={16} />
              New audiobook
            </PillButton>
          )}
        </div>
      </header>

      <main className="wrap">
        {error ? <p className="banner">{error}</p> : null}

        <AnimatePresence>
          {creating ? (
            <motion.form
              className="library-create"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              onSubmit={(event) => {
                event.preventDefault();
                void onCreate();
              }}
            >
              <SectionsCard
                id="library.new-audiobook"
                title={<h2 className="library-create-title">New audiobook</h2>}
                meta="Title is required. Everything else can wait."
                sections={formSections}
                footer={
                  <>
                    <PillButton variant="ghost" onClick={closeCreate}>
                      Cancel
                    </PillButton>
                    <PillButton type="submit" disabled={saving || draft.title.trim().length === 0}>
                      {saving ? "Creating…" : "Create"}
                    </PillButton>
                  </>
                }
              />
            </motion.form>
          ) : null}
        </AnimatePresence>

        {loading ? (
          <p className="muted">Loading library…</p>
        ) : audiobooks.length === 0 && !creating ? (
          <div className="empty-state">
            <BookOpen size={28} />
            <h2>No audiobooks yet</h2>
            <p>Start with a title. Open it and drop audio files to create chapters.</p>
            <PillButton onClick={openCreate}>
              <Plus size={16} />
              Create first audiobook
            </PillButton>
          </div>
        ) : audiobooks.length > 0 ? (
          <>
            <p className="section-label">{audiobooks.length} titles</p>
            <div className="grid">
              {audiobooks.map((book, index) => (
                <motion.div
                  key={book.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                >
                  <Link
                    className={`chapter-card book-card${book.hasCover ? " has-cover" : ""}${book.progressRatio > 0.96 && book.chapterCount > 0 ? " finished" : ""}`}
                    to={`/audiobooks/${book.id}`}
                  >
                    {book.progressRatio > 0.96 && book.chapterCount > 0 ? (
                      <span className="finished-badge" title="Finished">
                        <CheckCircle2 size={15} />
                      </span>
                    ) : null}
                    {book.hasCover ? (
                      <img
                        className="book-cover"
                        src={audiobookCoverUrl(book.id, book.updatedAt)}
                        alt=""
                      />
                    ) : null}
                    <span className="chapter-num mono">
                      {book.seriesTitle
                        ? `${book.seriesTitle}${book.seriesIndex ? ` · ${book.seriesIndex}` : ""}`
                        : "Standalone"}
                    </span>
                    <h3 className="chapter-title">{book.title}</h3>
                    <p className="card-sub">{book.author ?? book.subtitle ?? "No author yet"}</p>
                    <div className="chapter-meta">
                      <span className="dur">
                        {book.chapterCount} {book.chapterCount === 1 ? "chapter" : "chapters"}
                        {book.completedChapterCount > 0
                          ? ` · ${book.completedChapterCount} done`
                          : book.progressRatio > 0
                            ? " · in progress"
                            : ""}
                      </span>
                      <span className="chapter-play">Open</span>
                    </div>
                    <div
                      className="progress-sliver"
                      style={{ width: `${(Math.min(1, book.progressRatio) * 100).toFixed(1)}%` }}
                    />
                  </Link>
                </motion.div>
              ))}
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}
