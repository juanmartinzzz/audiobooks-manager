import { Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { createPortal } from "react-dom";
import { formatPlaybackTime } from "../lib/audioDuration";
import { toRoman } from "../lib/roman";
import type { Chapter } from "../types";

type Props = {
  chapter: Chapter;
  coverUrl: string | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  skipBack: number;
  skipForward: number;
  hasAudio: boolean;
  onExpand: () => void;
  onTogglePlay: () => void;
  onSkip: (delta: number) => void;
  onStop: () => void;
};

export function MiniPlayer({
  chapter,
  coverUrl,
  playing,
  currentTime,
  duration,
  skipBack,
  skipForward,
  hasAudio,
  onExpand,
  onTogglePlay,
  onSkip,
  onStop,
}: Props) {
  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const timeLabel = `${formatPlaybackTime(currentTime)} / ${duration > 0 ? formatPlaybackTime(duration) : "—"}`;

  return createPortal(
    <div className="mini-player" role="region" aria-label="Mini player">
      <div className="mini-player-progress" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>

      <div className="mini-player-inner">
        <button type="button" className="mini-player-meta" onClick={onExpand}>
          {coverUrl ? (
            <img className="mini-player-cover" src={coverUrl} alt="" />
          ) : (
            <span className="mini-player-cover mini-player-cover-fallback" aria-hidden="true">
              {toRoman(chapter.position)}
            </span>
          )}
          <span className="mini-player-copy">
            <span className="mini-player-title">{chapter.title}</span>
            <span className="mini-player-sub">
              <span>Chapter {toRoman(chapter.position)}</span>
              <span className="mini-player-time mono">{timeLabel}</span>
            </span>
          </span>
        </button>

        <div className="mini-player-controls">
          <button
            type="button"
            className="mini-player-btn"
            disabled={!hasAudio}
            title={`Skip back ${skipBack}s`}
            aria-label={`Skip back ${skipBack} seconds`}
            onClick={() => onSkip(-skipBack)}
          >
            <SkipBack size={16} />
            <span className="mini-player-skip-label">{skipBack}</span>
          </button>
          <button
            type="button"
            className={`mini-player-btn mini-player-play${playing ? " is-playing" : ""}`}
            disabled={!hasAudio}
            aria-label={playing ? "Pause" : "Play"}
            onClick={onTogglePlay}
          >
            {playing ? <Pause size={18} /> : <Play size={18} style={{ marginLeft: 2 }} />}
          </button>
          <button
            type="button"
            className="mini-player-btn"
            disabled={!hasAudio}
            title={`Skip forward ${skipForward}s`}
            aria-label={`Skip forward ${skipForward} seconds`}
            onClick={() => onSkip(skipForward)}
          >
            <SkipForward size={16} />
            <span className="mini-player-skip-label">{skipForward}</span>
          </button>
        </div>

        <button
          type="button"
          className="mini-player-stop"
          onClick={onStop}
          aria-label="Stop and close player"
          title="Stop and close"
        >
          <X size={16} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
