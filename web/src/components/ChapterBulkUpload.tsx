import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Upload } from "lucide-react";
import { SectionsCard, type SectionsCardSection } from "./interaction/SectionsCard";
import { TextInput } from "./interaction/TextInput";
import { PillButton } from "./PillButton";
import { uploadChapterAudio, MAX_AUDIO_BYTES } from "../lib/api";
import {
  chapterTitleFromFilename,
  formatBytes,
  isAudioFile,
  sortAudioFiles,
  stripLeadingNumbering,
} from "../lib/chapterTitle";
import { repeatedTitleSnippets, stripTitleSnippet } from "../lib/titleSnippets";
import { runPool } from "../lib/pool";
import "./ChapterBulkUpload.css";

const SNIPPET_PILL_LIMIT = 4;

const UPLOAD_CONCURRENCY = 2;

type DraftStatus = "ready" | "uploading" | "done" | "error";

type ChapterDraft = {
  id: string;
  file: File;
  title: string;
  hintedTitle: string;
  status: DraftStatus;
  progress: number;
  error: string | null;
};

type Props = {
  audiobookId: string;
  nextPosition: number;
  onUploaded: () => Promise<void> | void;
};

function statusLabel(draft: ChapterDraft): string | null {
  if (draft.status === "uploading") {
    return `Uploading ${Math.round(draft.progress * 100)}%`;
  }
  if (draft.status === "done") return "Uploaded";
  if (draft.status === "error") return draft.error ?? "Failed";
  return null;
}

function draftsFromFiles(files: File[]): ChapterDraft[] {
  return sortAudioFiles(files.filter(isAudioFile)).map((file) => {
    const hintedTitle = chapterTitleFromFilename(file.name);
    return {
      id: crypto.randomUUID(),
      file,
      title: hintedTitle,
      hintedTitle,
      status: (file.size > MAX_AUDIO_BYTES ? "error" : "ready") as DraftStatus,
      progress: 0,
      error: file.size > MAX_AUDIO_BYTES ? "File is over 512 MB" : null,
    };
  });
}

function positionOnGrid(
  startPosition: number,
  drafts: readonly { id: string }[],
  draftId: string,
): number | undefined {
  const index = drafts.findIndex((draft) => draft.id === draftId);
  if (index < 0) return undefined;
  return startPosition + index;
}

export function ChapterBulkUpload({ audiobookId, nextPosition, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<ChapterDraft[]>([]);
  const [startPosition, setStartPosition] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const [uploadingAll, setUploadingAll] = useState(false);
  const [stripText, setStripText] = useState("");
  const [snippetsExpanded, setSnippetsExpanded] = useState(false);

  const busy = uploadingAll || drafts.some((draft) => draft.status === "uploading");
  const pending = drafts.filter(
    (draft) =>
      draft.title.trim().length > 0 &&
      draft.file.size <= MAX_AUDIO_BYTES &&
      (draft.status === "ready" || draft.status === "error"),
  );
  const suggestions = useMemo(
    () =>
      repeatedTitleSnippets(
        drafts
          .filter((draft) => draft.status === "ready" || draft.status === "error")
          .map((draft) => draft.title),
      ),
    [drafts],
  );

  function applyStrip(snippet: string) {
    const needle = snippet.trim();
    if (!needle) return;
    setDrafts((current) =>
      current.map((draft) => {
        if (draft.status === "uploading" || draft.status === "done") return draft;
        const title = stripTitleSnippet(draft.title, needle);
        return {
          ...draft,
          title: title.length > 0 ? title : "Untitled chapter",
          status: draft.file.size > MAX_AUDIO_BYTES ? draft.status : "ready",
          error: draft.file.size > MAX_AUDIO_BYTES ? draft.error : null,
        };
      }),
    );
  }

  function addFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList);
    const audio = incoming.filter(isAudioFile);
    setSkipped(incoming.length - audio.length);
    if (audio.length === 0) return;
    if (drafts.length === 0) setStartPosition(nextPosition);
    setDrafts((current) => [...current, ...draftsFromFiles(audio)]);
  }

  function onInput(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer.files.length > 0) addFiles(event.dataTransfer.files);
  }

  function setDraft(id: string, patch: Partial<ChapterDraft>) {
    setDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));
  }

  function gridPosition(draftId: string): number | undefined {
    return positionOnGrid(startPosition ?? nextPosition, drafts, draftId);
  }

  function clearDrafts() {
    setDrafts([]);
    setStartPosition(null);
    setStripText("");
    setSnippetsExpanded(false);
  }

  function removeDraft(draftId: string) {
    const remaining = drafts.filter((item) => item.id !== draftId);
    setDrafts(remaining);
    if (remaining.length === 0) {
      setStartPosition(null);
      setStripText("");
      setSnippetsExpanded(false);
    }
  }

  async function uploadDraft(draft: ChapterDraft, position: number) {
    if (draft.title.trim().length === 0) return;
    if (draft.file.size > MAX_AUDIO_BYTES) {
      setDraft(draft.id, { status: "error", error: "File is over 512 MB" });
      return;
    }

    setDraft(draft.id, { status: "uploading", progress: 0, error: null });
    try {
      await uploadChapterAudio(audiobookId, {
        file: draft.file,
        title: draft.title,
        position,
        onProgress: (ratio) => setDraft(draft.id, { progress: ratio }),
      });
      setDraft(draft.id, { status: "done", progress: 1, error: null });
      await onUploaded();
    } catch (err) {
      setDraft(draft.id, {
        status: "error",
        error: err instanceof Error ? err.message : "Could not upload chapter",
      });
    }
  }

  async function uploadAll() {
    const toUpload = pending;
    if (toUpload.length === 0) return;
    setUploadingAll(true);
    try {
      await runPool(
        toUpload.flatMap((draft) => {
          const position = gridPosition(draft.id);
          return position === undefined ? [] : [{ draft, position }];
        }),
        UPLOAD_CONCURRENCY,
        async ({ draft, position }) => {
          await uploadDraft(draft, position);
        },
      );
    } finally {
      setUploadingAll(false);
    }
  }

  const drop = (
    <button
      type="button"
      className={`file-drop${dragOver ? " is-over" : ""}`}
      onClick={() => inputRef.current?.click()}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <Upload size={22} />
      <span className="file-drop-label">Drop audio files, or click to choose</span>
      <span className="file-drop-hint">Each file becomes a chapter after you confirm the names. Files over 99 MB are sent in chunks.</span>
    </button>
  );

  const visibleSuggestions =
    snippetsExpanded || suggestions.length <= SNIPPET_PILL_LIMIT
      ? suggestions
      : suggestions.slice(0, SNIPPET_PILL_LIMIT);
  const hiddenSuggestionCount = Math.max(0, suggestions.length - visibleSuggestions.length);

  const sections: SectionsCardSection[] = [
    {
      id: "files",
      title: "Files",
      description: "Drop several files at once. Grid order is chapter order, even if you upload one file at a time.",
      columns: [drop],
    },
  ];

  if (drafts.length > 0) {
    sections.push({
      id: "strip",
      title: "Strip from titles",
      description: "Type any text. It comes out of every name that hasn’t been uploaded yet.",
      columns: [
        <form
          key="strip"
          className="chapter-upload-strip"
          onSubmit={(event) => {
            event.preventDefault();
            applyStrip(stripText);
            setStripText("");
          }}
        >
          <TextInput
            id="chapter-strip-text"
            label="Text to remove"
            value={stripText}
            disabled={busy}
            placeholder="e.g. The Two Towers —"
            onChange={(event) => setStripText(event.target.value)}
          />
          <PillButton type="submit" disabled={busy || stripText.trim().length === 0}>
            Remove from titles
          </PillButton>
        </form>,
      ],
    });
  }

  if (suggestions.length > 0) {
    sections.push({
      id: "repeated",
      title: "Repeated in names",
      description: "Same space-separated text in at least three titles, as written. Tap one to strip it.",
      columns: [
        <div key="repeated" className="chapter-upload-pills" role="group" aria-label="Repeated text to remove">
          {visibleSuggestions.map((item) => (
            <button
              key={item.snippet}
              type="button"
              className="chapter-upload-pill"
              disabled={busy}
              aria-label={`Remove “${item.snippet}” from ${item.count} titles`}
              onClick={() => applyStrip(item.snippet)}
            >
              <span className="chapter-upload-pill-text">{item.snippet}</span>
            </button>
          ))}
          {suggestions.length > SNIPPET_PILL_LIMIT ? (
            <button
              type="button"
              className="chapter-upload-pills-more"
              disabled={busy}
              onClick={() => setSnippetsExpanded((current) => !current)}
            >
              {snippetsExpanded ? "Show less" : `Show more (${hiddenSuggestionCount})`}
            </button>
          ) : null}
        </div>,
      ],
    });
  }

  return (
    <div className="chapter-upload">
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.m4b,.aac,.wav,.flac,.ogg,.opus"
        multiple
        hidden
        onChange={onInput}
      />

      <SectionsCard
        id="audiobook.bulk-upload"
        title={<h2 className="chapter-upload-title">Add chapters from files</h2>}
        meta={
          drafts.length > 0
            ? `${drafts.length} ${drafts.length === 1 ? "file" : "files"} to confirm. Nothing is saved until you upload.`
            : "Names are the filename without the extension. Nothing is saved until you upload."
        }
        sections={sections}
        footer={
          drafts.length > 0 ? (
            <>
              <div className="chapter-upload-footer-secondary">
                <PillButton
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    setDrafts((current) =>
                      current.map((draft) =>
                        draft.status === "uploading" || draft.status === "done"
                          ? draft
                          : { ...draft, title: draft.hintedTitle },
                      ),
                    )
                  }
                >
                  Re-hint names
                </PillButton>
                <PillButton
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    setDrafts((current) =>
                      current.map((draft) => {
                        if (draft.status === "uploading" || draft.status === "done") return draft;
                        const title = stripLeadingNumbering(draft.title);
                        return {
                          ...draft,
                          title: title.length > 0 ? title : "Untitled chapter",
                        };
                      }),
                    )
                  }
                >
                  Strip leading numbers
                </PillButton>
                <PillButton
                  variant="ghost"
                  disabled={busy}
                  onClick={clearDrafts}
                >
                  Discard
                </PillButton>
              </div>
              <PillButton disabled={busy || pending.length === 0} onClick={() => void uploadAll()}>
                {uploadingAll ? "Uploading…" : `Upload all (${pending.length})`}
              </PillButton>
            </>
          ) : null
        }
      />

      {skipped > 0 ? (
        <p className="banner">{skipped} non-audio {skipped === 1 ? "file was" : "files were"} skipped.</p>
      ) : null}

      {drafts.length > 0 ? (
        <div className="draft-grid">
          {drafts.map((draft) => {
            const status = statusLabel(draft);
            return (
            <SectionsCard
              key={draft.id}
              id={`audiobook.chapter-draft.${draft.id}`}
              title={
                <h3 className="draft-card-title">{draft.title.trim() || "Untitled chapter"}</h3>
              }
              meta={
                <>
                  <span>{draft.file.name}</span>
                  <span>{formatBytes(draft.file.size)}</span>
                  {status ? <span className={`draft-card-status is-${draft.status}`}>{status}</span> : null}
                </>
              }
              sections={[
                {
                  id: "title",
                  title: "Chapter title to save",
                  columns: [
                    <TextInput
                      key="title"
                      id={`draft-title-${draft.id}`}
                      aria-label="Chapter title to save"
                      value={draft.title}
                      disabled={draft.status === "uploading" || draft.status === "done"}
                      onChange={(event) => setDraft(draft.id, { title: event.target.value, status: "ready", error: null })}
                    />,
                  ],
                },
              ]}
              footer={
                <>
                  {draft.status === "uploading" ? (
                    <progress className="draft-progress" max={1} value={draft.progress} />
                  ) : (
                    <PillButton
                      variant="ghost"
                      disabled={busy}
                      onClick={() => removeDraft(draft.id)}
                    >
                      Remove
                    </PillButton>
                  )}
                  <PillButton
                    disabled={
                      busy ||
                      draft.title.trim().length === 0 ||
                      draft.status === "done" ||
                      draft.status === "uploading" ||
                      draft.file.size > MAX_AUDIO_BYTES
                    }
                    onClick={() => {
                      const position = gridPosition(draft.id);
                      if (position === undefined) return;
                      void uploadDraft(draft, position);
                    }}
                  >
                    {draft.status === "done"
                      ? "Uploaded"
                      : draft.status === "uploading"
                        ? "Uploading…"
                        : draft.status === "error"
                          ? "Retry"
                          : "Upload this chapter"}
                  </PillButton>
                </>
              }
            />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
