export type PlaybackSettings = {
  segmentMinutes: number;
  skipBack: number;
  skipForward: number;
};

export type PlaybackPrefs = {
  pauseAtSegmentEnd: boolean;
  autoNextChapter: boolean;
  playbackRate: number;
};

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  segmentMinutes: 2,
  skipBack: 15,
  skipForward: 30,
};

export const DEFAULT_PLAYBACK_PREFS: PlaybackPrefs = {
  pauseAtSegmentEnd: false,
  autoNextChapter: false,
  playbackRate: 1,
};

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

const SETTINGS_KEY = "audiobooks.playback-settings.v1";
const PREFS_KEY = "audiobooks.playback-prefs.v1";

function readJson<T>(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota / private mode
  }
}

export function clampPlaybackSettings(input: Partial<PlaybackSettings>): PlaybackSettings {
  return {
    segmentMinutes: clampInt(input.segmentMinutes, 1, 60, DEFAULT_PLAYBACK_SETTINGS.segmentMinutes),
    skipBack: clampInt(input.skipBack, 5, 120, DEFAULT_PLAYBACK_SETTINGS.skipBack),
    skipForward: clampInt(input.skipForward, 5, 120, DEFAULT_PLAYBACK_SETTINGS.skipForward),
  };
}

export function clampPlaybackPrefs(input: Partial<PlaybackPrefs>): PlaybackPrefs {
  const rate = typeof input.playbackRate === "number" ? input.playbackRate : DEFAULT_PLAYBACK_PREFS.playbackRate;
  const allowed = PLAYBACK_RATES.find((value) => value === rate) ?? DEFAULT_PLAYBACK_PREFS.playbackRate;
  return {
    pauseAtSegmentEnd: Boolean(input.pauseAtSegmentEnd),
    autoNextChapter: Boolean(input.autoNextChapter),
    playbackRate: allowed,
  };
}

export function loadPlaybackSettings(): PlaybackSettings {
  const stored = readJson<PlaybackSettings>(SETTINGS_KEY);
  if (!stored || typeof stored !== "object") return { ...DEFAULT_PLAYBACK_SETTINGS };
  return clampPlaybackSettings(stored as Partial<PlaybackSettings>);
}

export function savePlaybackSettings(settings: PlaybackSettings) {
  writeJson(SETTINGS_KEY, clampPlaybackSettings(settings));
}

export function loadPlaybackPrefs(): PlaybackPrefs {
  const stored = readJson<PlaybackPrefs>(PREFS_KEY);
  if (!stored || typeof stored !== "object") return { ...DEFAULT_PLAYBACK_PREFS };
  return clampPlaybackPrefs(stored as Partial<PlaybackPrefs>);
}

export function savePlaybackPrefs(prefs: PlaybackPrefs) {
  writeJson(PREFS_KEY, clampPlaybackPrefs(prefs));
}

export function segmentLengthSeconds(segmentMinutes: number): number {
  return Math.max(60, segmentMinutes * 60);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}
