import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, Plus } from "lucide-react";
import { Modal } from "../components/Modal";
import { PillButton } from "../components/PillButton";
import { createAudiobook, listAudiobooks } from "../lib/api";
import { emptyAudiobookDraft, type Audiobook, type AudiobookDraft } from "../types";

export function LibraryPage() {
  const navigate = useNavigate();
  const [audiobooks, setAudiobooks] = useState<Audiobook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<AudiobookDraft>(emptyAudiobookDraft);
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

  async function onCreate() {
    setSaving(true);
    setError(null);
    try {
      const { audiobook } = await createAudiobook(draft);
      await refresh();
      setCreating(false);
      setDraft(emptyAudiobookDraft());
      navigate(`/audiobooks/${audiobook.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create audiobook");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="top">
        <div className="wrap header-row">
          <div>
            <p className="brand-eyebrow">Audiobooks Manager</p>
            <h1 className="brand-title">Library</h1>
            <p className="brand-sub">Create a book, then open it to add chapters and listen.</p>
          </div>
          <PillButton onClick={() => setCreating(true)}>
            <Plus size={16} />
            New audiobook
          </PillButton>
        </div>
      </header>

      <main className="wrap">
        {error ? <p className="banner">{error}</p> : null}

        {loading ? (
          <p className="muted">Loading library…</p>
        ) : audiobooks.length === 0 ? (
          <div className="empty-state">
            <BookOpen size={28} />
            <h2>No audiobooks yet</h2>
            <p>Start with a title. Audio files go in later.</p>
            <PillButton onClick={() => setCreating(true)}>
              <Plus size={16} />
              Create first audiobook
            </PillButton>
          </div>
        ) : (
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
                  <Link className="chapter-card book-card" to={`/audiobooks/${book.id}`}>
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
                      </span>
                      <span className="chapter-play">Open</span>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          </>
        )}
      </main>

      <AnimatePresence>
        {creating ? (
          <Modal title="New audiobook" onClose={() => setCreating(false)}>
            <form
              className="form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void onCreate();
              }}
            >
              <Field label="Title" required>
                <input
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  autoFocus
                  required
                />
              </Field>
              <Field label="Subtitle" help="Shown under the title on the listening page">
                <input
                  value={draft.subtitle}
                  onChange={(event) => setDraft({ ...draft, subtitle: event.target.value })}
                />
              </Field>
              <Field label="Author">
                <input
                  value={draft.author}
                  onChange={(event) => setDraft({ ...draft, author: event.target.value })}
                />
              </Field>
              <Field label="Narrator">
                <input
                  value={draft.narrator}
                  onChange={(event) => setDraft({ ...draft, narrator: event.target.value })}
                />
              </Field>
              <Field label="Series">
                <input
                  value={draft.seriesTitle}
                  onChange={(event) => setDraft({ ...draft, seriesTitle: event.target.value })}
                />
              </Field>
              <Field label="Series index" help="1, 2, 3…">
                <input
                  inputMode="numeric"
                  value={draft.seriesIndex}
                  onChange={(event) => setDraft({ ...draft, seriesIndex: event.target.value })}
                />
              </Field>
              <Field label="Description">
                <textarea
                  rows={3}
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
              </Field>
              <div className="modal-actions">
                <PillButton variant="ghost" onClick={() => setCreating(false)}>
                  Cancel
                </PillButton>
                <PillButton type="submit" disabled={saving || draft.title.trim().length === 0}>
                  {saving ? "Creating…" : "Create"}
                </PillButton>
              </div>
            </form>
          </Modal>
        ) : null}
      </AnimatePresence>
    </>
  );
}

function Field({
  label,
  help,
  required,
  children,
}: {
  label: string;
  help?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {required ? " *" : ""}
      </span>
      {children}
      {help ? <span className="field-help">{help}</span> : null}
    </label>
  );
}
