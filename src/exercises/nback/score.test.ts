import { describe, expect, it } from "vitest";
import { countErrors, type NbackScoreTrial, nextN, scoreNback } from "./score";

function trial(
  isTarget: boolean,
  responded: boolean,
  opts: { isLure?: boolean; scored?: boolean; rtMs?: number | null } = {},
): NbackScoreTrial {
  return {
    isTarget: { position: isTarget },
    isLure: { position: opts.isLure ?? false },
    response: {
      responded: { position: responded },
      rtMs: { position: opts.rtMs ?? (responded ? 600 : null) },
    },
    scored: opts.scored ?? true,
  };
}

const M = ["position"];

describe("scoreNback", () => {
  it("gives a high d-prime for accurate discrimination", () => {
    const trials = [
      ...Array.from({ length: 5 }, () => trial(true, true)),
      ...Array.from({ length: 15 }, () => trial(false, false)),
    ];
    expect(scoreNback(trials, M).primaryScore).toBeGreaterThan(3);
  });

  it("gives roughly zero for pressing on every trial", () => {
    const trials = [
      ...Array.from({ length: 5 }, () => trial(true, true)),
      ...Array.from({ length: 15 }, () => trial(false, true)),
    ];
    // A perfect 100% hit rate that carries no information must not score well.
    expect(scoreNback(trials, M).primaryScore).toBeLessThan(0.6);
  });

  it("gives roughly zero for never pressing, despite 75% accuracy", () => {
    const trials = [
      ...Array.from({ length: 5 }, () => trial(true, false)),
      ...Array.from({ length: 15 }, () => trial(false, false)),
    ];
    expect(scoreNback(trials, M).primaryScore).toBeLessThan(0.6);
  });

  it("excludes unscored warmup trials", () => {
    const trials = [
      // These would wreck the score if counted.
      trial(false, true, { scored: false }),
      trial(false, true, { scored: false }),
      ...Array.from({ length: 5 }, () => trial(true, true)),
      ...Array.from({ length: 15 }, () => trial(false, false)),
    ];
    const result = scoreNback(trials, M);
    expect(result.metrics.trials).toBe(20);
    expect(result.primaryScore).toBeGreaterThan(3);
  });

  it("tracks the lure false-alarm rate separately", () => {
    const trials = [
      ...Array.from({ length: 4 }, () => trial(true, true)),
      // Four lures, three of which fooled the participant.
      trial(false, true, { isLure: true }),
      trial(false, true, { isLure: true }),
      trial(false, true, { isLure: true }),
      trial(false, false, { isLure: true }),
      ...Array.from({ length: 12 }, () => trial(false, false)),
    ];
    const { metrics } = scoreNback(trials, M);
    expect(metrics.lureTrials).toBe(4);
    expect(metrics.lureFalseAlarms).toBe(3);
    expect(metrics.lureFaRate).toBeCloseTo(0.75, 10);
  });

  it("reports NaN lure rate when there were no lures", () => {
    expect(scoreNback([trial(true, true), trial(false, false)], M).metrics.lureFaRate).toBeNaN();
  });

  it("averages d-prime across modalities for dual n-back", () => {
    const dual: NbackScoreTrial[] = [
      ...Array.from({ length: 5 }, () => ({
        isTarget: { position: true, audio: true },
        isLure: { position: false, audio: false },
        response: {
          responded: { position: true, audio: false },
          rtMs: { position: 500, audio: null },
        },
        scored: true,
      })),
      ...Array.from({ length: 15 }, () => ({
        isTarget: { position: false, audio: false },
        isLure: { position: false, audio: false },
        response: {
          responded: { position: false, audio: false },
          rtMs: { position: null, audio: null },
        },
        scored: true,
      })),
    ];
    const result = scoreNback(dual, ["position", "audio"]);
    // Position perfect, audio all misses: the combined score sits between them.
    expect(result.perModality.position?.dPrime).toBeGreaterThan(3);
    expect(result.perModality.audio?.dPrime).toBeLessThan(1);
    expect(result.primaryScore).toBeCloseTo(
      ((result.perModality.position?.dPrime as number) +
        (result.perModality.audio?.dPrime as number)) /
        2,
      10,
    );
  });

  it("averages reaction times over responded trials only", () => {
    const trials = [
      trial(true, true, { rtMs: 400 }),
      trial(true, true, { rtMs: 600 }),
      trial(false, false),
      trial(false, false),
    ];
    expect(scoreNback(trials, M).metrics.meanRt).toBe(500);
  });

  it("returns NaN rather than throwing for an empty scored set", () => {
    const result = scoreNback([trial(false, false, { scored: false })], M);
    expect(result.primaryScore).toBeNaN();
    expect(result.metrics.trials).toBe(0);
  });
});

describe("countErrors", () => {
  it("counts both misses and false alarms", () => {
    const trials = [
      trial(true, false), // miss
      trial(false, true), // false alarm
      trial(true, true), // correct
      trial(false, false), // correct
    ];
    expect(countErrors(trials, M)).toBe(2);
  });

  it("ignores unscored trials", () => {
    expect(countErrors([trial(true, false, { scored: false })], M)).toBe(0);
  });

  it("counts each modality independently in dual mode", () => {
    const trials: NbackScoreTrial[] = [
      {
        isTarget: { position: true, audio: true },
        isLure: { position: false, audio: false },
        response: { responded: { position: true, audio: false }, rtMs: {} },
        scored: true,
      },
    ];
    expect(countErrors(trials, ["position", "audio"])).toBe(1);
  });
});

describe("nextN", () => {
  it("advances on few errors and retreats on many", () => {
    expect(nextN(2, 0)).toBe(3);
    expect(nextN(2, 2)).toBe(3);
    expect(nextN(2, 5)).toBe(1);
    expect(nextN(2, 9)).toBe(1);
  });

  it("holds inside the dead zone, so n does not oscillate every block", () => {
    expect(nextN(2, 3)).toBe(2);
    expect(nextN(2, 4)).toBe(2);
  });

  it("clamps to the configured bounds", () => {
    expect(nextN(1, 8)).toBe(1);
    expect(nextN(9, 0)).toBe(9);
  });
});
