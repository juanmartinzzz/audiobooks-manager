const MAX_DURATION_SECONDS = 48 * 60 * 60;
const METADATA_TIMEOUT_MS = 8_000;

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function formatBitrate(bps: number): string {
  return `${Math.round(bps / 1000)} kbps`;
}

export function formatSampleRate(hz: number): string {
  if (hz % 1000 === 0) return `${hz / 1000} kHz`;
  const khz = hz / 1000;
  return `${Number(khz.toFixed(khz >= 10 ? 1 : 2))} kHz`;
}

export function formatChapterAudioFacts(chapter: {
  durationSeconds: number | null;
  audioAssetId: string | null;
  container: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  channels: number | null;
}): string {
  const parts: string[] = [];
  if (chapter.durationSeconds != null) parts.push(formatDuration(chapter.durationSeconds));
  if (chapter.container) parts.push(chapter.container);
  if (chapter.bitrate != null) parts.push(formatBitrate(chapter.bitrate));
  const unusual = chapter.channels === 1 || (chapter.sampleRate != null && chapter.sampleRate < 44100);
  if (unusual && chapter.sampleRate != null) {
    const layout = chapter.channels === 1 ? "mono" : chapter.channels === 2 ? "stereo" : null;
    parts.push(`${layout ? `${layout} ` : ""}${formatSampleRate(chapter.sampleRate)}`.trim());
  }
  if (parts.length > 0) return parts.join(" · ");
  return chapter.audioAssetId ? "Audio ready" : "No audio yet";
}

export function normalizeDurationSeconds(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_DURATION_SECONDS) return null;
  return value;
}

export function durationFromAudioFile(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    let settled = false;

    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
      resolve(normalizeDurationSeconds(value ?? Number.NaN));
    };

    const timer = window.setTimeout(() => finish(null), METADATA_TIMEOUT_MS);
    audio.preload = "metadata";
    audio.addEventListener("error", () => finish(null));
    audio.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        finish(audio.duration);
        return;
      }
      audio.currentTime = Number.MAX_SAFE_INTEGER;
    });
    audio.addEventListener("timeupdate", () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        finish(audio.duration);
      }
    });
    audio.src = url;
  });
}
