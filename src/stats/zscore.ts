/**
 * Standardisation against the user's own history.
 *
 * The app compares you to yourself, so "good" has to be defined relative to your
 * own distribution. A z-score does that, and the 100±15 rescaling in PLAN §7.4
 * exists so the number reads as "my past self is 100".
 */

import { mean, stdDev } from "./descriptive";

/** Standard score. Returns 0 when history is too short or has no spread. */
export function zScore(value: number, history: readonly number[]): number {
  if (history.length < 2) return 0;
  const sd = stdDev(history);
  if (sd === 0) return 0;
  return (value - mean(history)) / sd;
}

/**
 * Rescales a z-score to the familiar 100±15 scale.
 * Clamped to 40..160: beyond about ±4 SD the estimate says more about a short
 * history than about performance, and an unbounded number would look absurd.
 */
export function toIndexScale(z: number, higherIsBetter = true): number {
  const directed = higherIsBetter ? z : -z;
  return Math.round(Math.min(160, Math.max(40, 100 + 15 * directed)));
}

/** Fraction of history at or below `value`, as a 0..100 percentile. */
export function percentileOf(value: number, history: readonly number[]): number {
  if (history.length === 0) return Number.NaN;
  const below = history.filter((v) => v <= value).length;
  return (below / history.length) * 100;
}

/** Minimum runs before a standardised score is meaningful (PLAN §7.4). */
export const MIN_HISTORY_FOR_INDEX = 10;

export interface IndexScore {
  index: number;
  z: number;
  /** False when history is below MIN_HISTORY_FOR_INDEX; UI shows "測定中". */
  reliable: boolean;
  sampleSize: number;
}

export function computeIndex(
  value: number,
  history: readonly number[],
  higherIsBetter = true,
): IndexScore {
  const z = zScore(value, history);
  return {
    index: toIndexScale(z, higherIsBetter),
    z,
    reliable: history.length >= MIN_HISTORY_FOR_INDEX,
    sampleSize: history.length,
  };
}
