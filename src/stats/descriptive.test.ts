import { describe, expect, it } from "vitest";
import {
  coefficientOfVariation,
  linearSlope,
  mean,
  median,
  medianAbsoluteDeviation,
  movingAverage,
  quantile,
  stdDev,
  summarise,
} from "./descriptive";

describe("mean / stdDev", () => {
  it("computes known values", () => {
    expect(mean([2, 4, 4, 4, 5, 5, 7, 9])).toBe(5);
    // Sample SD (n-1), not population SD.
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 4);
  });

  it("returns 0 SD for a single value and NaN mean for none", () => {
    expect(stdDev([42])).toBe(0);
    expect(mean([])).toBeNaN();
  });

  it("gives 0 SD for identical values", () => {
    expect(stdDev([3, 3, 3, 3])).toBe(0);
  });
});

describe("quantile", () => {
  it("interpolates between neighbours", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([10, 20], 0.25)).toBe(12.5);
  });

  it("returns the extremes at 0 and 1", () => {
    expect(quantile([5, 1, 9, 3], 0)).toBe(1);
    expect(quantile([5, 1, 9, 3], 1)).toBe(9);
  });

  it("does not depend on input order", () => {
    expect(quantile([9, 1, 5, 3], 0.5)).toBe(quantile([1, 3, 5, 9], 0.5));
  });

  it("clamps out-of-range quantiles", () => {
    expect(quantile([1, 2, 3], -1)).toBe(1);
    expect(quantile([1, 2, 3], 2)).toBe(3);
  });

  it("handles the single-element and empty cases", () => {
    expect(quantile([7], 0.9)).toBe(7);
    expect(quantile([], 0.5)).toBeNaN();
  });
});

describe("median resists outliers", () => {
  it("barely moves when one lapse is added", () => {
    // This is why the reaction-time primary metric is the median: one 2000ms
    // lapse must not look like a large change in ability.
    const clean = [250, 260, 255, 248, 262];
    const withLapse = [...clean, 2000];
    expect(Math.abs(median(withLapse) - median(clean))).toBeLessThan(10);
    expect(mean(withLapse) - mean(clean)).toBeGreaterThan(250);
  });
});

describe("coefficientOfVariation", () => {
  it("is scale-invariant", () => {
    const a = [100, 110, 120];
    const b = a.map((v) => v * 10);
    expect(coefficientOfVariation(a)).toBeCloseTo(coefficientOfVariation(b), 10);
  });

  it("is 0 for constant input and NaN when the mean is 0", () => {
    expect(coefficientOfVariation([5, 5, 5])).toBe(0);
    expect(coefficientOfVariation([-1, 1])).toBeNaN();
  });
});

describe("medianAbsoluteDeviation", () => {
  it("approximates SD for normal-ish data but ignores an outlier", () => {
    const values = [10, 11, 12, 13, 14];
    expect(medianAbsoluteDeviation(values)).toBeCloseTo(1.4826, 3);
    expect(medianAbsoluteDeviation([...values, 1000])).toBeLessThan(4);
  });
});

describe("linearSlope", () => {
  it("is positive for a rising series and negative for a falling one", () => {
    expect(linearSlope([1, 2, 3, 4, 5])).toBeCloseTo(1, 10);
    expect(linearSlope([5, 4, 3, 2, 1])).toBeCloseTo(-1, 10);
  });

  it("is 0 for a flat series and for fewer than two points", () => {
    expect(linearSlope([3, 3, 3])).toBeCloseTo(0, 10);
    expect(linearSlope([7])).toBe(0);
    expect(linearSlope([])).toBe(0);
  });
});

describe("movingAverage", () => {
  it("uses a trailing window that shortens at the start", () => {
    expect(movingAverage([1, 2, 3, 4], 2)).toEqual([1, 1.5, 2.5, 3.5]);
  });

  it("with window 1 returns the input", () => {
    expect(movingAverage([4, 8, 15], 1)).toEqual([4, 8, 15]);
  });

  it("rejects a window below 1", () => {
    expect(() => movingAverage([1], 0)).toThrow(RangeError);
  });
});

describe("summarise", () => {
  it("reports every field for a normal sample", () => {
    const result = summarise([10, 20, 30, 40, 50]);
    expect(result.n).toBe(5);
    expect(result.mean).toBe(30);
    expect(result.median).toBe(30);
    expect(result.min).toBe(10);
    expect(result.max).toBe(50);
  });

  it("returns NaNs rather than throwing on empty input", () => {
    const result = summarise([]);
    expect(result.n).toBe(0);
    expect(result.mean).toBeNaN();
    expect(result.p95).toBeNaN();
  });
});
