import { describe, expect, it } from "vitest";
import { isPersonalBest, summariseBucket } from "./runs";
import type { Run } from "./types";

function run(id: string, score: number, startedAt: number): Run {
  return {
    id,
    schemaVersion: 1,
    userId: "u",
    deviceId: "d",
    exerciseId: "reactiontime",
    bucketVersion: 1,
    scoreBucket: "bucket-a",
    configSnapshot: {},
    seed: "seed",
    deviceProfile: {
      deviceClass: "desktop-keyboard",
      refreshRateHz: 60,
      refreshRateMeasured: true,
      clockResolutionMs: 0.005,
      screen: { width: 1920, height: 1080, dpr: 1 },
      platform: "Windows",
      measuredAt: 0,
    },
    startedAt,
    durationMs: 30000,
    metrics: {},
    primaryScore: score,
    valid: true,
    suspicion: [],
    appVersion: "0.1.0",
    updatedAt: startedAt,
  };
}

describe("summariseBucket", () => {
  const runs = [
    run("a", 280, 1000),
    run("b", 250, 2000),
    run("c", 265, 3000),
    run("d", 240, 4000),
    run("e", 270, 5000),
    run("f", 300, 6000),
  ];

  it("takes the minimum as best when lower is better", () => {
    expect(summariseBucket(runs, false)?.best).toBe(240);
  });

  it("takes the maximum as best when higher is better", () => {
    expect(summariseBucket(runs, true)?.best).toBe(300);
  });

  it("averages only the five most recent runs", () => {
    // Most recent five by startedAt: f,e,d,c,b = 300,270,240,265,250 → 265
    expect(summariseBucket(runs, false)?.recentMean).toBeCloseTo(265, 10);
  });

  it("averages all runs when fewer than five exist", () => {
    const few = [run("a", 200, 1000), run("b", 300, 2000)];
    expect(summariseBucket(few, false)?.recentMean).toBe(250);
  });

  it("reports first and last played regardless of array order", () => {
    const shuffled = [runs[3], runs[0], runs[5], runs[1]] as Run[];
    const summary = summariseBucket(shuffled, false);
    expect(summary?.firstPlayedAt).toBe(1000);
    expect(summary?.lastPlayedAt).toBe(6000);
  });

  it("returns null for no runs", () => {
    expect(summariseBucket([], false)).toBeNull();
  });
});

describe("isPersonalBest", () => {
  const previous = [run("a", 280, 1), run("b", 250, 2), run("c", 265, 3)];

  it("is true for a faster time when lower is better", () => {
    expect(isPersonalBest(240, previous, false)).toBe(true);
    expect(isPersonalBest(260, previous, false)).toBe(false);
  });

  it("is true for a higher score when higher is better", () => {
    expect(isPersonalBest(300, previous, true)).toBe(true);
    expect(isPersonalBest(270, previous, true)).toBe(false);
  });

  it("does not count a tie as a personal best", () => {
    expect(isPersonalBest(250, previous, false)).toBe(false);
    expect(isPersonalBest(280, previous, true)).toBe(false);
  });

  it("is true for the very first run", () => {
    expect(isPersonalBest(999, [], false)).toBe(true);
  });
});
