import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Upload } from "lucide-react";
import { SectionsCard } from "./interaction/SectionsCard";
import { TextInput } from "./interaction/TextInput";
import { PillButton } from "./PillButton";
import { uploadChapterAudio, MAX_AUDIO_BYTES } from "../lib/api";
import {
  chapterTitleFromFilename,
  formatBytes,
  isAudioFile,
  sortAudioFiles,
} from "../lib/chapterTitle";
import { runPool } from "../lib/pool";
import "./ChapterBulkUpload.css";

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

function statusLabel(draft: ChapterDraft): string {
  if (draft.status === "uploading") {
    return `Uploading ${Math.round(draft.progress * 100)}%`;
  }
  if (draft.status === "done") return "Uploaded";
  if (draft.status === "error") return draft.error ?? "Failed";
  return "Ready to confirm";
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

export function ChapterBulkUpload({ audiobookId, nextPosition, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<ChapterDraft[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const [uploadingAll, setUploadingAll] = useState(false);

  const busy = uploadingAll || drafts.some((draft) => draft.status === "uploading");
  const pending = drafts.filter(
    (draft) =>
      draft.title.trim().length > 0 &&
      draft.file.size <= MAX_AUDIO_BYTES &&
      (draft.status === "ready" || draft.status === "error"),
  );

  function addFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList);
    const audio = incoming.filter(isAudioFile);
    setSkipped(incoming.length - audio.length);
    if (audio.length === 0) return;
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

  async function uploadDraft(draft: ChapterDraft, position?: number) {
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
        toUpload.map((draft, index) => ({ draft, position: nextPosition + index })),
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
        meta="Names are hinted from filenames. Nothing is saved until you upload."
        sections={[
          {
            id: "files",
            title: "Files",
            description: "Drop several files at once. Order follows the filenames.",
            columns: [drop],
          },
        ]}
      />

      {skipped > 0 ? (
        <p className="banner">{skipped} non-audio {skipped === 1 ? "file was" : "files were"} skipped.</p>
      ) : null}

      {drafts.length > 0 ? (
        <>
          <div className="chapter-upload-actions">
            <p className="section-label">
              {drafts.length} {drafts.length === 1 ? "file" : "files"} to confirm
            </p>
            <div className="chapter-upload-actions-buttons">
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
              <PillButton variant="ghost" disabled={busy} onClick={() => setDrafts([])}>
                Discard
              </PillButton>
              <PillButton disabled={busy || pending.length === 0} onClick={() => void uploadAll()}>
                {uploadingAll ? "Uploading…" : `Upload all (${pending.length})`}
              </PillButton>
            </div>
          </div>

          <div className="draft-grid">
            {drafts.map((draft) => (
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
                    <span className={`draft-card-status is-${draft.status}`}>{statusLabel(draft)}</span>
                  </>
                }
                sections={[
                  {
                    id: "title",
                    title: "Chapter title",
                    description: "Hinted from the filename. Edit it before this file is uploaded.",
                    columns: [
                      <TextInput
                        key="title"
                        label="Title"
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
                        onClick={() => setDrafts((current) => current.filter((item) => item.id !== draft.id))}
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
                      onClick={() => void uploadDraft(draft)}
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
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
