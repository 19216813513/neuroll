import { describe, expect, it } from "vitest";
import type { Tally } from "./engine";
import { scoreTyping } from "./score";

const MINUTE = 60_000;

function tally(overrides: Partial<Tally> = {}): Tally {
  return {
    correctChars: 300,
    incorrectChars: 0,
    typedChars: 300,
    correctKeystrokes: 300,
    corrections: 0,
    words: 60,
    ...overrides,
  };
}

describe("scoreTyping", () => {
  it("uses the five-characters-per-word convention", () => {
    // 300 characters in one minute is 60 WPM by definition. If this number ever
    // drifts, every score in the database becomes incomparable with the rest of
    // the world's.
    const { metrics, primaryScore } = scoreTyping(tally(), [], MINUTE);

    expect(metrics.wpm).toBeCloseTo(60, 6);
    expect(primaryScore).toBeCloseTo(60, 6);
  });

  it("scales with elapsed time", () => {
    expect(scoreTyping(tally(), [], MINUTE / 2).metrics.wpm).toBeCloseTo(120, 6);
    expect(scoreTyping(tally(), [], MINUTE * 2).metrics.wpm).toBeCloseTo(30, 6);
  });

  it("separates what survived from what was attempted", () => {
    // Half the characters typed were wrong and left standing: the work was done,
    // but only the correct half is text.
    const { metrics } = scoreTyping(
      tally({ correctChars: 150, incorrectChars: 150, typedChars: 300, correctKeystrokes: 150 }),
      [],
      MINUTE,
    );

    expect(metrics.wpm).toBeCloseTo(30, 6);
    expect(metrics.wpmGross).toBeCloseTo(60, 6);
    expect(metrics.accuracy).toBeCloseTo(50, 6);
    expect(metrics.errors).toBe(150);
  });

  it("counts corrections as keystrokes but not as characters", () => {
    const { metrics } = scoreTyping(tally({ corrections: 60 }), [], MINUTE);

    // 300 characters plus 60 backspaces of mechanical work.
    expect(metrics.kpm).toBeCloseTo(360, 6);
    // The text is unchanged by having been corrected.
    expect(metrics.wpm).toBeCloseTo(60, 6);
    expect(metrics.corrections).toBe(60);
  });

  it("summarises the keystroke rhythm", () => {
    const ikis = [100, 120, 140, 160, 180, 200, 220, 240, 260, 900];

    const { metrics } = scoreTyping(tally(), ikis, MINUTE);

    expect(metrics.ikiMedianMs).toBeCloseTo(190, 6);
    // p95 is the point of the statistic: one 900ms hunt for a key is invisible
    // in the mean and obvious here.
    expect(metrics.ikiP95Ms as number).toBeGreaterThan(500);
    expect(metrics.ikiCv as number).toBeGreaterThan(0);
  });

  it("returns NaN rather than a fake number when there is nothing to divide by", () => {
    // A run aborted before the first keystroke has no elapsed time and no
    // keystrokes. Reporting 0 WPM at 0% accuracy would look like a terrible
    // session instead of an absent one.
    const empty = scoreTyping(
      tally({ correctChars: 0, typedChars: 0, correctKeystrokes: 0, words: 0 }),
      [],
      0,
    );

    expect(Number.isNaN(empty.metrics.wpm as number)).toBe(true);
    expect(Number.isNaN(empty.metrics.accuracy as number)).toBe(true);
    expect(Number.isNaN(empty.metrics.ikiMedianMs as number)).toBe(true);
  });

  it("needs at least two intervals before reporting a rhythm", () => {
    // One interval has no spread, so a CV computed from it would read as perfect
    // consistency rather than as no data.
    const { metrics } = scoreTyping(tally(), [150], MINUTE);

    expect(Number.isNaN(metrics.ikiCv as number)).toBe(true);
    expect(Number.isNaN(metrics.ikiP95Ms as number)).toBe(true);
  });
});
