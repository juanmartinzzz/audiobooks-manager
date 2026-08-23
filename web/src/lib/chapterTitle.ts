const AUDIO_EXT = /\.(mp3|m4a|m4b|aac|wav|flac|ogg|opus|webm|mp4)$/i;

export function chapterTitleFromFilename(filename: string): string {
  const trimmed = filename.trim();
  let name = trimmed.replace(AUDIO_EXT, "");
  name = name.replace(/\.[^.]+$/, "");
  name = name.replace(/_/g, " ");
  name = name.replace(/\s+/g, " ").trim();
  name = name.replace(
    /^(?:(?:chapter|ch|track|disc|part|ep|episode)\s*)?#?\s*\d+\s*(?:[.)\]:_-]|–|—)?\s*/i,
    "",
  );
  name = name.replace(/^[-–—.:]+\s*/, "");
  name = name.replace(/\s+/g, " ").trim();

  if (name.length > 0) return name;
  const fallback = trimmed.replace(AUDIO_EXT, "").trim();
  return fallback.length > 0 ? fallback : "Untitled chapter";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function sortAudioFiles(files: File[]): File[] {
  return [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
  );
}

export function isAudioFile(file: File): boolean {
  if (file.type.startsWith("audio/") || file.type === "video/mp4") return true;
  return AUDIO_EXT.test(file.name);
}
