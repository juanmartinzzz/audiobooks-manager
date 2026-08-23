import type { ChapterProgress } from "../types";

const NEAR_END_SECONDS = 3;
const FINISHED_RATIO = 0.96;

export function playedFraction(progress: ChapterProgress | undefined): number {
  if (!progress) return 0;
  if (progress.completed) return 1;
  const duration = progress.durationSeconds ?? 0;
  if (duration <= 0) return 0;
  return Math.min(1, Math.max(0, progress.positionSeconds / duration));
}

export function isFinished(progress: ChapterProgress | undefined): boolean {
  if (!progress) return false;
  if (progress.completed) return true;
  return playedFraction(progress) > FINISHED_RATIO;
}

export function completedFromPosition(positionSeconds: number, durationSeconds: number | null): boolean {
  if (durationSeconds == null || durationSeconds <= 0) return false;
  return positionSeconds >= durationSeconds - NEAR_END_SECONDS || positionSeconds / durationSeconds > FINISHED_RATIO;
}

/** Seconds to seek on open, or null to start at the beginning. */
export function resumeSeconds(
  progress: ChapterProgress | undefined,
  fallbackDuration: number | null,
): number | null {
  if (!progress || progress.completed) return null;
  const duration = progress.durationSeconds ?? fallbackDuration ?? 0;
  const position = progress.positionSeconds;
  if (position <= 0) return null;
  if (duration > 0 && position >= duration - NEAR_END_SECONDS) return null;
  return position;
}
