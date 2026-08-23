const AUDIO_EXT = /\.(mp3|m4a|m4b|aac|wav|flac|ogg|opus|webm|mp4)$/i;

export function chapterTitleFromFilename(filename: string): string {
  const name = filename.trim().replace(AUDIO_EXT, "").trim();
  return name.length > 0 ? name : "Untitled chapter";
}

/** Optional. Strips a leading track/chapter number and the separator after it. */
export function stripLeadingNumbering(title: string): string {
  let name = title.trim();
  name = name.replace(
    /^(?:(?:chapter|ch|track|disc|part|ep|episode)\s*)?#?\s*\d+\s*(?:[.)\]:_-]|–|—)?\s*/i,
    "",
  );
  name = name.replace(/^[-–—.:]+\s*/, "");
  name = name.replace(/\s+/g, " ").trim();
  return name;
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
