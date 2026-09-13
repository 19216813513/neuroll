/**
 * Typing metrics (PLAN §5.4).
 *
 * Pure: no browser API, no engine state, just counts in and numbers out, so the
 * same function can re-score a stored run later on a server.
 *
 * The headline number is net WPM, defined the standard way — five characters to
 * a "word", counting the separating spaces, over the elapsed minutes, using only
 * the characters left standing correct. Gross WPM counts every character attempt
 * instead, so the gap between the two is exactly what the mistakes cost.
 */

import { coefficientOfVariation, median, quantile } from "~/stats/descriptive";
import type { Tally } from "./engine";

/** Characters per "word" in the WPM convention. */
const CHARS_PER_WORD = 5;

export interface TypingScore {
  metrics: Record<string, number>;
  primaryScore: number;
}

export function scoreTyping(
  tally: Tally,
  ikiMs: readonly number[],
  elapsedMs: number,
): TypingScore {
  const minutes = elapsedMs / 60_000;
  const rate = (chars: number): number =>
    minutes > 0 ? chars / CHARS_PER_WORD / minutes : Number.NaN;

  const wpm = rate(tally.correctChars);
  const metrics = {
    wpm,
    wpmGross: rate(tally.typedChars),
    // Every key that did something, corrections included: the mechanical work
    // done, as opposed to the text produced.
    kpm: minutes > 0 ? (tally.typedChars + tally.corrections) / minutes : Number.NaN,
    accuracy:
      tally.typedChars > 0 ? (tally.correctKeystrokes / tally.typedChars) * 100 : Number.NaN,
    errors: tally.incorrectChars,
    corrections: tally.corrections,
    chars: tally.correctChars,
    words: tally.words,
    ...ikiMetrics(ikiMs),
  };

  return { metrics, primaryScore: wpm };
}

/**
 * Keystroke interval statistics.
 *
 * The median is the steady rhythm. p95 is where the run actually breaks: a
 * typist at 70 WPM averages ~170ms between keys, so a p95 of 600ms means a
 * handful of characters are being hunted for, and those are the ones worth
 * drilling. The coefficient of variation says whether the typing is even or
 * bursty, independent of how fast it is.
 */
function ikiMetrics(ikiMs: readonly number[]): Record<string, number> {
  if (ikiMs.length < 2) {
    return { ikiMedianMs: Number.NaN, ikiP95Ms: Number.NaN, ikiCv: Number.NaN };
  }
  return {
    ikiMedianMs: median(ikiMs),
    ikiP95Ms: quantile(ikiMs, 0.95),
    ikiCv: coefficientOfVariation(ikiMs),
  };
}
