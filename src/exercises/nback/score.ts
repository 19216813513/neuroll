/**
 * N-back scoring.
 *
 * Pure — no DOM, no timers — so the same function can re-score a run from
 * `(seed, config, responses)` inside a Worker later (PLAN §9.4b).
 *
 * The headline number is d-prime, not accuracy. In a task where roughly 75% of
 * trials are non-targets, never pressing the button scores 75% "correct" while
 * demonstrating nothing. d-prime measures the separation between how you treat
 * targets and how you treat non-targets, so it cannot be gamed by a response
 * strategy. See stats/sdt.ts.
 */

import { mean, stdDev } from "~/stats/descriptive";
import { computeSdt, tally } from "~/stats/sdt";

export interface NbackResponse {
  /** Per-modality: did the participant press that modality's key this trial? */
  responded: Record<string, boolean>;
  /** Per-modality reaction time from stimulus onset, null when no press. */
  rtMs: Record<string, number | null>;
}

export interface NbackScoreTrial {
  isTarget: Record<string, boolean>;
  isLure: Record<string, boolean>;
  response: NbackResponse;
  /** Trials before index n cannot be targets and are excluded from scoring. */
  scored: boolean;
}

export interface NbackScore {
  metrics: Record<string, number>;
  primaryScore: number;
  perModality: Record<string, { dPrime: number; hitRate: number; falseAlarmRate: number }>;
}

export function scoreNback(
  trials: readonly NbackScoreTrial[],
  modalities: readonly string[],
): NbackScore {
  const scored = trials.filter((trial) => trial.scored);
  const perModality: NbackScore["perModality"] = {};
  const metrics: Record<string, number> = {};
  const dPrimes: number[] = [];
  const allRts: number[] = [];

  let lureTrials = 0;
  let lureFalseAlarms = 0;

  for (const modality of modalities) {
    const cells = tally(
      scored.map((trial) => ({
        isTarget: trial.isTarget[modality] === true,
        responded: trial.response.responded[modality] === true,
      })),
    );
    const sdt = computeSdt(cells);

    perModality[modality] = {
      dPrime: sdt.dPrime,
      hitRate: sdt.hitRate,
      falseAlarmRate: sdt.falseAlarmRate,
    };

    if (Number.isFinite(sdt.dPrime)) dPrimes.push(sdt.dPrime);

    metrics[`dPrime_${modality}`] = sdt.dPrime;
    metrics[`hitRate_${modality}`] = sdt.hitRate;
    metrics[`faRate_${modality}`] = sdt.falseAlarmRate;

    for (const trial of scored) {
      const rt = trial.response.rtMs[modality];
      if (rt !== null && rt !== undefined && Number.isFinite(rt)) allRts.push(rt);

      // Lure trials are the diagnostic ones: falling for them means responding
      // on familiarity rather than on actual position in the sequence.
      if (trial.isLure[modality] === true && trial.isTarget[modality] !== true) {
        lureTrials++;
        if (trial.response.responded[modality] === true) lureFalseAlarms++;
      }
    }
  }

  const dPrime = dPrimes.length > 0 ? mean(dPrimes) : Number.NaN;

  metrics.dPrime = dPrime;
  metrics.trials = scored.length;
  metrics.meanRt = allRts.length > 0 ? mean(allRts) : Number.NaN;
  metrics.sdRt = allRts.length > 1 ? stdDev(allRts) : Number.NaN;
  metrics.lureTrials = lureTrials;
  metrics.lureFalseAlarms = lureFalseAlarms;
  metrics.lureFaRate = lureTrials > 0 ? lureFalseAlarms / lureTrials : Number.NaN;

  return { metrics, primaryScore: dPrime, perModality };
}

/**
 * Jaeggi-style adaptive rule, applied per block.
 *
 * Errors are counted across all modalities, so dual n-back demands accuracy on
 * both streams before advancing. The asymmetric thresholds (advance at <=2,
 * retreat at >=5) leave a deliberate dead zone: without it, n would oscillate
 * every block and never settle at the level actually being trained.
 */
export interface AdaptiveRule {
  advanceAtOrBelow: number;
  retreatAtOrAbove: number;
  minN: number;
  maxN: number;
}

export const DEFAULT_ADAPTIVE_RULE: AdaptiveRule = {
  advanceAtOrBelow: 2,
  retreatAtOrAbove: 5,
  minN: 1,
  maxN: 9,
};

export function nextN(
  currentN: number,
  errors: number,
  rule: AdaptiveRule = DEFAULT_ADAPTIVE_RULE,
): number {
  if (errors <= rule.advanceAtOrBelow) return Math.min(rule.maxN, currentN + 1);
  if (errors >= rule.retreatAtOrAbove) return Math.max(rule.minN, currentN - 1);
  return currentN;
}

/** Total misses plus false alarms across every modality, for the adaptive rule. */
export function countErrors(
  trials: readonly NbackScoreTrial[],
  modalities: readonly string[],
): number {
  let errors = 0;
  for (const trial of trials) {
    if (!trial.scored) continue;
    for (const modality of modalities) {
      const isTarget = trial.isTarget[modality] === true;
      const responded = trial.response.responded[modality] === true;
      if (isTarget !== responded) errors++;
    }
  }
  return errors;
}
