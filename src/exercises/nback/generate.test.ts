import { describe, expect, it } from "vitest";
import { createRng } from "~/core/rng";
import { type GenerateOptions, generateSequence } from "./generate";

const base: GenerateOptions = {
  n: 2,
  trials: 22,
  targetRate: 0.25,
  lureRate: 0,
  streams: [{ modality: "position", alphabetSize: 9 }],
};

function run(options: Partial<GenerateOptions>, seed = "s") {
  return generateSequence({ ...base, ...options }, createRng(seed));
}

/** Recomputes target flags from the raw values, independent of the generator. */
function verifyTargets(seq: ReturnType<typeof run>, n: number, key = "position") {
  for (let i = 0; i < seq.length; i++) {
    const claimed = (seq[i] as (typeof seq)[number]).isTarget[key];
    const actual =
      i >= n &&
      (seq[i] as (typeof seq)[number]).values[key] ===
        (seq[i - n] as (typeof seq)[number]).values[key];
    expect(claimed).toBe(actual);
  }
}

describe("generateSequence", () => {
  it("is deterministic for a given seed", () => {
    expect(run({}, "same")).toEqual(run({}, "same"));
  });

  it("produces different sequences for different seeds", () => {
    expect(run({}, "a")).not.toEqual(run({}, "b"));
  });

  it("emits exactly the requested number of trials", () => {
    expect(run({ trials: 30 })).toHaveLength(30);
  });

  it("never marks the first n trials as targets", () => {
    for (const n of [1, 2, 3, 5]) {
      const seq = run({ n, trials: 40 });
      for (let i = 0; i < n; i++) {
        expect((seq[i] as (typeof seq)[number]).isTarget.position).toBe(false);
      }
    }
  });

  it("target flags always agree with the actual values", () => {
    for (const n of [1, 2, 3, 4]) {
      for (const seed of ["a", "b", "c"]) {
        const seq = generateSequence({ ...base, n, trials: 50 }, createRng(seed));
        verifyTargets(seq, n);
      }
    }
  });

  it("hits the requested target rate on eligible trials", () => {
    for (const targetRate of [0.1, 0.25, 0.4]) {
      const seq = run({ targetRate, trials: 82, n: 2 });
      const eligible = seq.length - 2;
      const targets = seq.filter((t) => t.isTarget.position).length;
      expect(targets).toBe(Math.round(eligible * targetRate));
    }
  });

  it("produces no targets at a rate of 0 and all targets at 1", () => {
    expect(run({ targetRate: 0 }).filter((t) => t.isTarget.position)).toHaveLength(0);
    const all = run({ targetRate: 1, trials: 22, n: 2 });
    expect(all.filter((t) => t.isTarget.position)).toHaveLength(20);
  });

  it("creates lures that match n±1 but never n", () => {
    const n = 3;
    const seq = generateSequence(
      { ...base, n, trials: 80, targetRate: 0.2, lureRate: 0.25 },
      createRng("lure"),
    );
    const lures = seq.filter((t) => t.isLure.position);
    expect(lures.length).toBeGreaterThan(5);

    for (let i = 0; i < seq.length; i++) {
      if (!(seq[i] as (typeof seq)[number]).isLure.position) continue;
      const value = (seq[i] as (typeof seq)[number]).values.position;
      // A lure must not be a real target...
      expect((seq[i] as (typeof seq)[number]).isTarget.position).toBe(false);
      expect(value).not.toBe((seq[i - n] as (typeof seq)[number]).values.position);
      // ...and must match at n-1 or n+1 back.
      const neighbours = [i - n - 1, i - n + 1]
        .filter((index) => index >= 0 && index < i)
        .map((index) => (seq[index] as (typeof seq)[number]).values.position);
      expect(neighbours).toContain(value);
    }
  });

  it("keeps targets correct even with a high lure rate", () => {
    const seq = generateSequence(
      { ...base, n: 2, trials: 60, targetRate: 0.3, lureRate: 0.3 },
      createRng("mixed"),
    );
    verifyTargets(seq, 2);
  });

  it("never reports a trial as both target and lure", () => {
    const seq = generateSequence(
      { ...base, n: 2, trials: 60, targetRate: 0.3, lureRate: 0.4 },
      createRng("both"),
    );
    for (const trial of seq) {
      expect(trial.isTarget.position && trial.isLure.position).toBe(false);
    }
  });

  it("handles n=1, where the only lure neighbour is i-2", () => {
    const seq = generateSequence(
      { ...base, n: 1, trials: 40, targetRate: 0.25, lureRate: 0.25 },
      createRng("n1"),
    );
    verifyTargets(seq, 1);
    for (let i = 0; i < seq.length; i++) {
      if (!(seq[i] as (typeof seq)[number]).isLure.position) continue;
      expect(i).toBeGreaterThanOrEqual(2);
      expect((seq[i] as (typeof seq)[number]).values.position).toBe(
        (seq[i - 2] as (typeof seq)[number]).values.position,
      );
    }
  });

  it("generates independent streams for dual n-back", () => {
    const seq = generateSequence(
      {
        ...base,
        trials: 60,
        streams: [
          { modality: "position", alphabetSize: 9 },
          { modality: "audio", alphabetSize: 8 },
        ],
      },
      createRng("dual"),
    );
    verifyTargets(seq, 2, "position");
    verifyTargets(seq, 2, "audio");

    // The two streams must not be copies of each other, or the task collapses
    // into a single-modality one with two buttons.
    const positionTargets = seq.map((t) => t.isTarget.position).join("");
    const audioTargets = seq.map((t) => t.isTarget.audio).join("");
    expect(positionTargets).not.toBe(audioTargets);
  });

  it("keeps every value inside the alphabet", () => {
    const seq = generateSequence(
      { ...base, trials: 100, streams: [{ modality: "position", alphabetSize: 4 }] },
      createRng("small"),
    );
    for (const trial of seq) {
      expect(trial.values.position).toBeGreaterThanOrEqual(0);
      expect(trial.values.position).toBeLessThan(4);
    }
  });

  it("still produces correct targets with a minimal alphabet of 2", () => {
    const seq = generateSequence(
      { ...base, n: 2, trials: 40, streams: [{ modality: "position", alphabetSize: 2 }] },
      createRng("binary"),
    );
    verifyTargets(seq, 2);
  });

  it("rejects invalid configurations", () => {
    expect(() => run({ n: 0 })).toThrow(RangeError);
    expect(() => run({ n: 5, trials: 5 })).toThrow(RangeError);
    expect(() => run({ streams: [] })).toThrow(RangeError);
    expect(() => run({ streams: [{ modality: "position", alphabetSize: 1 }] })).toThrow(RangeError);
  });
});
