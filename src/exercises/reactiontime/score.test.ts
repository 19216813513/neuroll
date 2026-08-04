import { describe, expect, it } from "vitest";
import type { TrialRecord } from "~/exercises/types";
import { scoreReactionTime } from "./def";

function trials(rts: (number | null)[]): TrialRecord[] {
  return rts.map((rtMs, i) => ({
    i,
    stimulus: { index: 0, waitMs: 1500 },
    isTarget: true,
    response: rtMs === null ? "wrong" : "space",
    correct: rtMs !== null,
    rtMs,
    presentedAt: i * 2000,
  }));
}

describe("scoreReactionTime", () => {
  it("uses the median as the primary score", () => {
    const { metrics, primaryScore } = scoreReactionTime(trials([200, 250, 300]), 0);
    expect(metrics.medianRt).toBe(250);
    expect(primaryScore).toBe(250);
  });

  it("reports best, mean and spread", () => {
    const { metrics } = scoreReactionTime(trials([210, 230, 250, 270, 290]), 0);
    expect(metrics.bestRt).toBe(210);
    expect(metrics.meanRt).toBe(250);
    expect(metrics.sdRt).toBeCloseTo(31.6228, 3);
  });

  it("counts responses over 500ms as lapses", () => {
    const { metrics } = scoreReactionTime(trials([240, 260, 700, 1200, 250]), 0);
    expect(metrics.lapses).toBe(2);
  });

  it("excludes incorrect trials from the timing statistics", () => {
    // A wrong key in choice mode has no meaningful reaction time; including it
    // would let a mis-press masquerade as a fast response.
    const { metrics } = scoreReactionTime(trials([240, null, 260, null, 250]), 0);
    expect(metrics.medianRt).toBe(250);
    expect(metrics.accuracy).toBeCloseTo(0.6, 10);
  });

  it("passes false starts through", () => {
    const { metrics } = scoreReactionTime(trials([240, 250]), 3);
    expect(metrics.falseStarts).toBe(3);
  });

  it("returns NaN rather than throwing when nothing was measurable", () => {
    const { metrics, primaryScore } = scoreReactionTime(trials([null, null]), 1);
    expect(primaryScore).toBeNaN();
    expect(metrics.falseStarts).toBe(1);
  });

  it("handles an empty trial list", () => {
    expect(scoreReactionTime([], 0).primaryScore).toBeNaN();
  });

  it("is unaffected by one slow outlier, unlike the mean", () => {
    const clean = scoreReactionTime(trials([240, 250, 260, 245, 255]), 0);
    const withLapse = scoreReactionTime(trials([240, 250, 260, 245, 255, 1800]), 0);
    expect(Math.abs(withLapse.primaryScore - clean.primaryScore)).toBeLessThan(10);
    expect((withLapse.metrics.meanRt as number) - (clean.metrics.meanRt as number)).toBeGreaterThan(
      200,
    );
  });
});
