import { describe, expect, it } from "vitest";
import { computeSdt, probit, tally } from "./sdt";

describe("probit", () => {
  // Reference values from the standard normal distribution.
  it("matches known quantiles", () => {
    expect(probit(0.5)).toBeCloseTo(0, 6);
    expect(probit(0.975)).toBeCloseTo(1.959964, 4);
    expect(probit(0.025)).toBeCloseTo(-1.959964, 4);
    expect(probit(0.95)).toBeCloseTo(1.644854, 4);
    expect(probit(0.99)).toBeCloseTo(2.326348, 4);
    expect(probit(0.841344746)).toBeCloseTo(1.0, 4);
  });

  it("is antisymmetric about 0.5", () => {
    for (const p of [0.01, 0.1, 0.3, 0.45]) {
      expect(probit(p)).toBeCloseTo(-probit(1 - p), 5);
    }
  });

  it("stays accurate in the far tails where the approximation switches branch", () => {
    expect(probit(0.001)).toBeCloseTo(-3.090232, 4);
    expect(probit(0.999)).toBeCloseTo(3.090232, 4);
    expect(probit(0.0001)).toBeCloseTo(-3.719016, 3);
  });

  it("handles degenerate inputs", () => {
    expect(probit(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(probit(1)).toBe(Number.POSITIVE_INFINITY);
    expect(probit(-0.1)).toBeNaN();
    expect(probit(1.1)).toBeNaN();
  });
});

describe("computeSdt", () => {
  it("gives d-prime near zero when hits and false alarms match", () => {
    const result = computeSdt({
      hits: 10,
      misses: 10,
      falseAlarms: 30,
      correctRejections: 30,
    });
    expect(result.dPrime).toBeCloseTo(0, 1);
  });

  it("gives a large positive d-prime for good discrimination", () => {
    const result = computeSdt({
      hits: 19,
      misses: 1,
      falseAlarms: 1,
      correctRejections: 59,
    });
    expect(result.dPrime).toBeGreaterThan(3);
  });

  it("goes negative when the responder is systematically wrong", () => {
    const result = computeSdt({
      hits: 2,
      misses: 18,
      falseAlarms: 50,
      correctRejections: 10,
    });
    expect(result.dPrime).toBeLessThan(0);
  });

  it("stays finite at a perfect score (the reason for the correction)", () => {
    const result = computeSdt({
      hits: 20,
      misses: 0,
      falseAlarms: 0,
      correctRejections: 60,
    });
    expect(Number.isFinite(result.dPrime)).toBe(true);
    expect(result.dPrime).toBeGreaterThan(3);
    expect(result.corrected).toBe(true);
  });

  it("does not reward pressing on every trial", () => {
    // The core claim of d-prime: a perfect hit rate earned by responding to
    // everything carries no information, and must not score like real ability.
    const alwaysPress = computeSdt({
      hits: 20,
      misses: 0,
      falseAlarms: 60,
      correctRejections: 0,
    });
    const genuine = computeSdt({ hits: 19, misses: 1, falseAlarms: 1, correctRejections: 59 });

    expect(alwaysPress.hitRate).toBe(1);
    expect(alwaysPress.dPrime).toBeLessThan(0.5);
    expect(alwaysPress.dPrime).toBeLessThan(genuine.dPrime - 3);
  });

  it("is exactly zero for a non-discriminating responder with balanced trials", () => {
    // The log-linear correction is only symmetric when signal and noise trial
    // counts match. With 20 signal vs 60 noise trials it nudges the smaller-N
    // rate further from its boundary, so an "always press" run lands slightly
    // below zero rather than exactly on it. Equal counts isolate the property.
    const balanced = computeSdt({ hits: 20, misses: 0, falseAlarms: 20, correctRejections: 0 });
    expect(balanced.dPrime).toBeCloseTo(0, 10);

    const halfAndHalf = computeSdt({
      hits: 10,
      misses: 10,
      falseAlarms: 10,
      correctRejections: 10,
    });
    expect(halfAndHalf.dPrime).toBeCloseTo(0, 10);
  });

  it("reports criterion sign for liberal and conservative responders", () => {
    const liberal = computeSdt({ hits: 19, misses: 1, falseAlarms: 30, correctRejections: 30 });
    const conservative = computeSdt({ hits: 8, misses: 12, falseAlarms: 1, correctRejections: 59 });
    expect(liberal.criterion).toBeLessThan(0);
    expect(conservative.criterion).toBeGreaterThan(0);
  });

  it("returns NaN when a trial class is absent", () => {
    expect(
      computeSdt({ hits: 0, misses: 0, falseAlarms: 5, correctRejections: 5 }).dPrime,
    ).toBeNaN();
    expect(
      computeSdt({ hits: 5, misses: 5, falseAlarms: 0, correctRejections: 0 }).dPrime,
    ).toBeNaN();
  });

  it("flags corrected only at the boundaries", () => {
    expect(
      computeSdt({ hits: 15, misses: 5, falseAlarms: 10, correctRejections: 50 }).corrected,
    ).toBe(false);
  });
});

describe("tally", () => {
  it("sorts trials into the four SDT cells", () => {
    const counts = tally([
      { isTarget: true, responded: true },
      { isTarget: true, responded: true },
      { isTarget: true, responded: false },
      { isTarget: false, responded: true },
      { isTarget: false, responded: false },
      { isTarget: false, responded: false },
    ]);
    expect(counts).toEqual({ hits: 2, misses: 1, falseAlarms: 1, correctRejections: 2 });
  });

  it("handles an empty list", () => {
    expect(tally([])).toEqual({ hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0 });
  });
});
