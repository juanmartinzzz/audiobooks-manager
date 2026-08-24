import { useEffect, useRef, useState, type RefObject } from "react";
import { ChevronDown, Moon, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { MiniPlayer } from "./MiniPlayer";
import { PillSelect } from "./interaction/PillSelect";
import { formatPlaybackTime } from "../lib/audioDuration";
import { completedFromPosition } from "../lib/playbackProgress";
import {
  PLAYBACK_RATES,
  segmentLengthSeconds,
  type PlaybackPrefs,
  type PlaybackSettings,
} from "../lib/playbackPrefs";
import { toRoman } from "../lib/roman";
import type { Chapter } from "../types";

const SPEED_OPTIONS = PLAYBACK_RATES.map((rate) => ({
  value: String(rate),
  label: `${rate}×`,
}));

const SAVE_INTERVAL_MS = 20_000;

const SLEEP_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "10", label: "10 min" },
  { value: "20", label: "20 min" },
  { value: "30", label: "30 min" },
  { value: "45", label: "45 min" },
  { value: "60", label: "60 min" },
  { value: "chapter", label: "End of chapter" },
];

type SleepMode = "off" | "timer" | "chapter";

type ProgressPayload = {
  chapterId: string;
  positionSeconds: number;
  durationSeconds: number | null;
  completed: boolean;
};

type Props = {
  audioRef: RefObject<HTMLAudioElement | null>;
  chapter: Chapter;
  chapters: Chapter[];
  settings: PlaybackSettings;
  prefs: PlaybackPrefs;
  autoplay: boolean;
  resumeSeconds: number | null;
  onPrefsChange: (prefs: PlaybackPrefs) => void;
  onProgress: (payload: ProgressPayload) => void;
  onSelectChapter: (id: string) => void;
  onExpand: () => void;
  onCollapse: () => void;
  onClose: () => void;
  expanded: boolean;
  coverUrl: string | null;
};

export function NowPlaying({
  audioRef,
  chapter,
  chapters,
  settings,
  prefs,
  autoplay,
  resumeSeconds,
  onPrefsChange,
  onProgress,
  onSelectChapter,
  onExpand,
  onCollapse,
  onClose,
  expanded,
  coverUrl,
}: Props) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const lastSeenSegmentRef = useRef(-1);
  const pendingSeekRef = useRef<number | null>(null);
  const prefsRef = useRef(prefs);
  const settingsRef = useRef(settings);
  const chapterRef = useRef(chapter);
  const chaptersRef = useRef(chapters);
  const onSelectChapterRef = useRef(onSelectChapter);
  const onProgressRef = useRef(onProgress);
  const autoplayRef = useRef(autoplay);
  const resumeSecondsRef = useRef(resumeSeconds);
  const lastSaveAtRef = useRef(0);
  const didResumeToastRef = useRef(false);
  const didAutoplayRef = useRef(false);
  const sleepEndsAtRef = useRef<number | null>(null);
  const sleepChoiceRef = useRef("off");

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(chapter.durationSeconds ?? 0);
  const [sleepChoice, setSleepChoice] = useState("off");
  const [sleepLeft, setSleepLeft] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  prefsRef.current = prefs;
  settingsRef.current = settings;
  chapterRef.current = chapter;
  chaptersRef.current = chapters;
  onSelectChapterRef.current = onSelectChapter;
  onProgressRef.current = onProgress;
  autoplayRef.current = autoplay;
  resumeSecondsRef.current = resumeSeconds;
  sleepChoiceRef.current = sleepChoice;
  const sleepMode: SleepMode =
    sleepChoice === "off" ? "off" : sleepChoice === "chapter" ? "chapter" : "timer";

  const hasAudio = chapter.audioAssetId != null;
  const segLen = segmentLengthSeconds(settings.segmentMinutes);
  const waypointTotal = duration > 0 ? Math.ceil(duration / segLen) : 0;
  const currentSeg = duration > 0 ? Math.min(waypointTotal - 1, Math.floor(currentTime / segLen)) : 0;

  function showToast(message: string) {
    setToast(message);
  }

  function seekTo(seconds: number) {
    const audio = audioRef.current;
    const cap =
      audio && Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : Number.POSITIVE_INFINITY;
    const next = Math.max(0, Math.min(seconds, cap));
    lastSeenSegmentRef.current = Math.floor(next / segmentLengthSeconds(settingsRef.current.segmentMinutes));
    if (!audio || audio.readyState < 1) {
      pendingSeekRef.current = next;
      setCurrentTime(next);
      return;
    }
    audio.currentTime = next;
    setCurrentTime(next);
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch((err: unknown) => {
        showToast(err instanceof Error ? err.message : "Could not play this chapter");
      });
      return;
    }
    audio.pause();
  }

  function skipBy(delta: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const here = audio.currentTime || 0;
    const cap =
      Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Number.POSITIVE_INFINITY;
    seekTo(Math.max(0, Math.min(cap, here + delta)));
  }

  function applyLoadedDuration(audio: HTMLAudioElement) {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration);
    }
  }

  function maybePauseAtWaypoint(audio: HTMLAudioElement) {
    const dur = audio.duration || duration;
    if (!dur) return;
    const length = segmentLengthSeconds(settingsRef.current.segmentMinutes);
    const curSeg = Math.floor(audio.currentTime / length);
    if (curSeg === lastSeenSegmentRef.current) return;

    if (
      lastSeenSegmentRef.current !== -1 &&
      prefsRef.current.pauseAtSegmentEnd &&
      curSeg > lastSeenSegmentRef.current
    ) {
      const boundary = curSeg * length;
      audio.currentTime = boundary;
      audio.pause();
      lastSeenSegmentRef.current = curSeg;
      setCurrentTime(boundary);
      showToast(`Paused at waypoint ${curSeg + 1}`);
      return;
    }

    lastSeenSegmentRef.current = curSeg;
  }

  function advanceToNextChapter() {
    const list = chaptersRef.current;
    const current = chapterRef.current;
    const index = list.findIndex((item) => item.id === current.id);
    const next = list.slice(index + 1).find((item) => item.audioAssetId != null);
    if (next) {
      showToast("Continuing the journey — next chapter");
      onSelectChapterRef.current(next.id);
      return true;
    }
    return false;
  }

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    lastSeenSegmentRef.current = -1;
    lastSaveAtRef.current = 0;
    didResumeToastRef.current = false;
    didAutoplayRef.current = false;
    pendingSeekRef.current = resumeSecondsRef.current;
    setCurrentTime(resumeSecondsRef.current ?? 0);
    setDuration(chapterRef.current.durationSeconds ?? 0);
    setPlaying(false);
  }, [chapter.id]);

  useEffect(() => {
    if (!expanded) return;
    sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [expanded, chapter.id]);

  useEffect(() => {
    document.body.classList.toggle("has-mini-player", playing);
    return () => document.body.classList.remove("has-mini-player");
  }, [playing]);

  useEffect(() => {
    lastSeenSegmentRef.current = -1;
  }, [settings.segmentMinutes]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = prefs.playbackRate;
  }, [prefs.playbackRate]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !hasAudio) return;
    const chapterId = chapter.id;
    const fallbackDuration = chapter.durationSeconds;

    function emitProgress(options: { completed?: boolean; position?: number } = {}) {
      const player = audioRef.current;
      if (!player) return;
      const now = Date.now();
      const isChapterEnd = options.completed === true;
      if (!isChapterEnd && now - lastSaveAtRef.current < SAVE_INTERVAL_MS) return;
      lastSaveAtRef.current = now;
      const duration =
        Number.isFinite(player.duration) && player.duration > 0 ? player.duration : fallbackDuration;
      const position = options.position ?? player.currentTime ?? 0;
      const completed = options.completed ?? completedFromPosition(position, duration);
      onProgressRef.current({
        chapterId,
        positionSeconds: position,
        durationSeconds: duration,
        completed,
      });
    }

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime || 0);
      maybePauseAtWaypoint(audio);
      if (!audio.paused) emitProgress();
    };
    const onLoaded = () => {
      applyLoadedDuration(audio);
      if (pendingSeekRef.current != null) {
        const resumeAt = pendingSeekRef.current;
        audio.currentTime = resumeAt;
        pendingSeekRef.current = null;
        if (resumeAt > 0 && !didResumeToastRef.current) {
          didResumeToastRef.current = true;
          showToast(`Resumed “${chapterRef.current.title}” at ${formatPlaybackTime(resumeAt)}`);
        }
      }
      if (autoplayRef.current && !didAutoplayRef.current) {
        didAutoplayRef.current = true;
        void audio.play().catch((err: unknown) => {
          showToast(err instanceof Error ? err.message : "Could not play this chapter");
        });
      }
    };
    const onEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
      lastSeenSegmentRef.current = -1;
      emitProgress({ completed: true, position: 0 });
      if (sleepChoiceRef.current === "chapter") {
        showToast("Chapter’s end — resting here for the night");
        setSleepChoice("off");
        setSleepLeft(null);
        sleepEndsAtRef.current = null;
        return;
      }
      if (prefsRef.current.autoNextChapter) {
        advanceToNextChapter();
      }
    };
    const onError = () => {
      setPlaying(false);
      showToast("Could not load this chapter’s audio");
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("durationchange", onLoaded);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.playbackRate = prefsRef.current.playbackRate;
    setPlaying(!audio.paused);
    if (!audio.paused) setCurrentTime(audio.currentTime || 0);
    applyLoadedDuration(audio);
    if (audio.readyState >= 1) onLoaded();

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("durationchange", onLoaded);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, [chapter.id, hasAudio]);

  useEffect(() => {
    if (sleepChoice === "off" || sleepChoice === "chapter") return;
    const tick = () => {
      const remaining = (sleepEndsAtRef.current ?? 0) - Date.now();
      if (remaining <= 0) {
        audioRef.current?.pause();
        showToast("Sleep timer ended — resting here");
        setSleepChoice("off");
        setSleepLeft(null);
        sleepEndsAtRef.current = null;
        return;
      }
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      setSleepLeft(`${minutes}:${String(seconds).padStart(2, "0")}`);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [sleepChoice]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!hasAudio) return;
      const tag = (event.target as HTMLElement | null)?.tagName ?? "";
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "BUTTON") return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      }
      if (event.code === "ArrowRight") {
        event.preventDefault();
        skipBy(settingsRef.current.skipForward);
      }
      if (event.code === "ArrowLeft") {
        event.preventDefault();
        skipBy(-settingsRef.current.skipBack);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hasAudio]);

  function onSleepChange(value: string) {
    setSleepChoice(value);
    if (value === "off") {
      setSleepLeft(null);
      sleepEndsAtRef.current = null;
      return;
    }
    if (value === "chapter") {
      setSleepLeft(null);
      sleepEndsAtRef.current = null;
      showToast("Will rest at the end of this chapter");
      return;
    }
    const minutes = Number(value);
    sleepEndsAtRef.current = Date.now() + minutes * 60 * 1000;
    showToast(`Sleep timer set for ${minutes} minutes`);
  }

  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const showMini = playing;

  return (
    <>
      <section
        ref={sectionRef}
        className={`now-playing${expanded ? "" : " is-collapsed"}`}
        aria-live="polite"
        hidden={!expanded}
      >
      <div className="np-head">
        <div>
          <p className="eyebrow">Chapter {toRoman(chapter.position)} · Now playing</p>
          <h2>{chapter.title}</h2>
        </div>
        <button
          type="button"
          className="np-close"
          onClick={onCollapse}
          aria-label="Minimize player"
          title="Keep listening in the mini player"
        >
          <ChevronDown size={20} />
        </button>
      </div>

      <div className="transport">
        <button
          type="button"
          className="transport-btn"
          disabled={!hasAudio}
          title={`Skip back ${settings.skipBack}s`}
          onClick={() => skipBy(-settings.skipBack)}
        >
          <SkipBack size={18} />
        </button>
        <button
          type="button"
          className="transport-btn play-main"
          disabled={!hasAudio}
          aria-label={playing ? "Pause" : "Play"}
          onClick={togglePlay}
        >
          {playing ? <Pause size={22} /> : <Play size={22} />}
        </button>
        <button
          type="button"
          className="transport-btn"
          disabled={!hasAudio}
          title={`Skip forward ${settings.skipForward}s`}
          onClick={() => skipBy(settings.skipForward)}
        >
          <SkipForward size={18} />
        </button>
        <div className="seek-row">
          <span className="time-mono">{formatPlaybackTime(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(currentTime, duration || 0)}
            disabled={!hasAudio || duration <= 0}
            style={{ background: `linear-gradient(90deg, var(--gold) ${pct}%, var(--border) ${pct}%)` }}
            onChange={(event) => seekTo(Number(event.target.value))}
          />
          <span className="time-mono end">{duration > 0 ? formatPlaybackTime(duration) : "—"}</span>
        </div>
      </div>

      {hasAudio ? (
        <>
          <div className="np-toolbar">
            <PillSelect
              label="Pace"
              value={String(prefs.playbackRate)}
              options={SPEED_OPTIONS}
              limit={4}
              onChange={(value) => onPrefsChange({ ...prefs, playbackRate: Number(value) })}
            />
            <div className="sleep-tool">
              <PillSelect
                label="Sleep"
                value={sleepChoice}
                options={SLEEP_OPTIONS}
                limit={4}
                onChange={onSleepChange}
              />
              {sleepMode === "timer" && sleepLeft ? (
                <span className="sleep-countdown">
                  <Moon size={12} />
                  {sleepLeft}
                </span>
              ) : null}
            </div>
            <label className="toggle" title="Stop precisely at each waypoint instead of reading through">
              <input
                type="checkbox"
                checked={prefs.pauseAtSegmentEnd}
                onChange={(event) => onPrefsChange({ ...prefs, pauseAtSegmentEnd: event.target.checked })}
              />
              <span className="track" />
              <span className="label-text">Pause at waypoints</span>
            </label>
            <label className="toggle" title="Automatically begin the next chapter when this one ends">
              <input
                type="checkbox"
                checked={prefs.autoNextChapter}
                onChange={(event) => onPrefsChange({ ...prefs, autoNextChapter: event.target.checked })}
              />
              <span className="track" />
              <span className="label-text">Continue journey</span>
            </label>
          </div>

          <div className="waypoints-head">
            <h3>Waypoints along this chapter</h3>
            <span className="hint">
              {duration > 0
                ? `${settings.segmentMinutes} min segments · ${waypointTotal} waypoints`
                : "loading chapter length…"}
            </span>
          </div>
          <div className="waypoint-grid">
            {duration > 0 ? (
              Array.from({ length: waypointTotal }, (_, index) => {
                const start = index * segLen;
                const end = Math.min(duration, start + segLen);
                return (
                  <button
                    key={index}
                    type="button"
                    className={`waypoint${index === currentSeg ? " current" : ""}`}
                    onClick={() => {
                      seekTo(start);
                      const audio = audioRef.current;
                      if (audio) void audio.play().catch(() => undefined);
                    }}
                  >
                    <span className="wp-badge">{index + 1}</span>
                    <span className="wp-range mono">
                      {formatPlaybackTime(start)} – {formatPlaybackTime(end)}
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="waypoint-loading">Reading the chapter’s length before laying out waypoints…</p>
            )}
          </div>
        </>
      ) : (
        <p className="muted">This chapter has no audio file yet. Play stays off until a file is attached.</p>
      )}
    </section>
    {toast ? (
      <div className="player-toast" role="status">
        {toast}
      </div>
    ) : null}
    {showMini ? (
      <MiniPlayer
        chapter={chapter}
        coverUrl={coverUrl}
        playing={playing}
        currentTime={currentTime}
        duration={duration}
        skipBack={settings.skipBack}
        skipForward={settings.skipForward}
        hasAudio={hasAudio}
        onExpand={onExpand}
        onTogglePlay={togglePlay}
        onSkip={skipBy}
        onStop={onClose}
      />
    ) : null}
    </>
  );
}
