/**
 * Signal detection theory.
 *
 * For N-back and any other yes/no task, hit rate alone is not a measure of
 * ability: pressing the button on every trial yields a perfect 100% hit rate.
 * d-prime separates sensitivity (can you tell targets from non-targets) from
 * bias (how willing are you to respond at all), which is why it is the primary
 * metric in PLAN §5.2 rather than accuracy.
 */

/**
 * Inverse standard normal CDF (probit).
 *
 * Acklam's rational approximation, accurate to ~1e-9 across the domain — far
 * beyond what trial counts in the dozens could ever require.
 */
export function probit(p: number): number {
  if (p <= 0 || p >= 1) {
    if (p === 0) return Number.NEGATIVE_INFINITY;
    if (p === 1) return Number.POSITIVE_INFINITY;
    return Number.NaN;
  }

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      ((((((c[0] as number) * q + (c[1] as number)) * q + (c[2] as number)) * q +
        (c[3] as number)) *
        q +
        (c[4] as number)) *
        q +
        (c[5] as number)) /
      (((((d[0] as number) * q + (d[1] as number)) * q + (d[2] as number)) * q + (d[3] as number)) *
        q +
        1)
    );
  }

  if (p > pHigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(
      ((((((c[0] as number) * q + (c[1] as number)) * q + (c[2] as number)) * q +
        (c[3] as number)) *
        q +
        (c[4] as number)) *
        q +
        (c[5] as number)) /
      (((((d[0] as number) * q + (d[1] as number)) * q + (d[2] as number)) * q + (d[3] as number)) *
        q +
        1)
    );
  }

  const q = p - 0.5;
  const r = q * q;
  return (
    (((((((a[0] as number) * r + (a[1] as number)) * r + (a[2] as number)) * r + (a[3] as number)) *
      r +
      (a[4] as number)) *
      r +
      (a[5] as number)) *
      q) /
    ((((((b[0] as number) * r + (b[1] as number)) * r + (b[2] as number)) * r + (b[3] as number)) *
      r +
      (b[4] as number)) *
      r +
      1)
  );
}

export interface SdtCounts {
  hits: number;
  misses: number;
  falseAlarms: number;
  correctRejections: number;
}

export interface SdtResult {
  dPrime: number;
  /** Criterion. Negative means liberal (over-responding), positive conservative. */
  criterion: number;
  beta: number;
  hitRate: number;
  falseAlarmRate: number;
  /** True when a rate hit 0 or 1 and the log-linear correction was applied. */
  corrected: boolean;
}

/**
 * Computes d-prime with the log-linear correction.
 *
 * A perfect score gives a hit rate of 1, whose probit is infinite — so a flawless
 * session would produce `Infinity` and break every average downstream. The
 * standard fix (Hautus 1995) adds 0.5 to each cell and 1 to each total, which is
 * applied unconditionally so that d-prime stays comparable across sessions rather
 * than only being adjusted for the extreme ones.
 */
export function computeSdt(counts: SdtCounts): SdtResult {
  const signalTrials = counts.hits + counts.misses;
  const noiseTrials = counts.falseAlarms + counts.correctRejections;

  if (signalTrials === 0 || noiseTrials === 0) {
    return {
      dPrime: Number.NaN,
      criterion: Number.NaN,
      beta: Number.NaN,
      hitRate: Number.NaN,
      falseAlarmRate: Number.NaN,
      corrected: false,
    };
  }

  const rawHitRate = counts.hits / signalTrials;
  const rawFaRate = counts.falseAlarms / noiseTrials;
  const atCeiling = rawHitRate === 0 || rawHitRate === 1 || rawFaRate === 0 || rawFaRate === 1;

  const hitRate = (counts.hits + 0.5) / (signalTrials + 1);
  const faRate = (counts.falseAlarms + 0.5) / (noiseTrials + 1);

  const zHit = probit(hitRate);
  const zFa = probit(faRate);
  const dPrime = zHit - zFa;
  const criterion = -0.5 * (zHit + zFa);
  const beta = Math.exp((zFa ** 2 - zHit ** 2) / 2);

  return {
    dPrime,
    criterion,
    beta,
    hitRate: rawHitRate,
    falseAlarmRate: rawFaRate,
    corrected: atCeiling,
  };
}

/** Tallies a trial list into SDT cells. */
export function tally(trials: readonly { isTarget: boolean; responded: boolean }[]): SdtCounts {
  const counts: SdtCounts = { hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0 };
  for (const trial of trials) {
    if (trial.isTarget) {
      if (trial.responded) counts.hits++;
      else counts.misses++;
    } else if (trial.responded) {
      counts.falseAlarms++;
    } else {
      counts.correctRejections++;
    }
  }
  return counts;
}
