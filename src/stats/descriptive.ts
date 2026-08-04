/**
 * Descriptive statistics.
 *
 * Pure functions, no browser APIs — this module has to run unchanged inside a
 * Cloudflare Worker when scores are re-verified server-side (PLAN §9.4b).
 */

export function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Sample standard deviation (n-1). Returns 0 for a single value. */
export function stdDev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function median(values: readonly number[]): number {
  return quantile(values, 0.5);
}

/**
 * Linear-interpolated quantile. Reaction time distributions are right-skewed, so
 * the median and p95 describe them far better than a mean and standard deviation.
 */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  if (values.length === 1) return values[0] as number;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * Math.min(Math.max(q, 0), 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower] as number;
  const weight = position - lower;
  return (sorted[lower] as number) * (1 - weight) + (sorted[upper] as number) * weight;
}

/**
 * Coefficient of variation: spread relative to magnitude.
 *
 * This is the consistency measure. Comparing raw standard deviations across
 * sessions would be misleading, because a faster performer has less room to vary
 * in absolute terms — dividing by the mean removes that dependence.
 */
export function coefficientOfVariation(values: readonly number[]): number {
  const m = mean(values);
  if (!Number.isFinite(m) || m === 0) return Number.NaN;
  return stdDev(values) / Math.abs(m);
}

/** Median absolute deviation, scaled to be comparable with a standard deviation. */
export function medianAbsoluteDeviation(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const med = median(values);
  return 1.4826 * median(values.map((v) => Math.abs(v - med)));
}

export interface Summary {
  n: number;
  mean: number;
  sd: number;
  median: number;
  min: number;
  max: number;
  p95: number;
  cv: number;
}

export function summarise(values: readonly number[]): Summary {
  if (values.length === 0) {
    return {
      n: 0,
      mean: Number.NaN,
      sd: Number.NaN,
      median: Number.NaN,
      min: Number.NaN,
      max: Number.NaN,
      p95: Number.NaN,
      cv: Number.NaN,
    };
  }
  return {
    n: values.length,
    mean: mean(values),
    sd: stdDev(values),
    median: median(values),
    min: Math.min(...values),
    max: Math.max(...values),
    p95: quantile(values, 0.95),
    cv: coefficientOfVariation(values),
  };
}

/** Least-squares slope of y over x. Used for the trend arrow in PLAN §7.3. */
export function linearSlope(ys: readonly number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = mean(ys);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * ((ys[i] as number) - yMean);
    denominator += (i - xMean) ** 2;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

/** Trailing moving average. Shorter windows at the start rather than padding. */
export function movingAverage(values: readonly number[], window: number): number[] {
  if (window < 1) throw new RangeError("window must be >= 1");
  return values.map((_, i) => mean(values.slice(Math.max(0, i - window + 1), i + 1)));
}
