/**
 * N-back stimulus sequence generation.
 *
 * The difficulty of an n-back session is decided here, not in the UI. Two knobs
 * matter:
 *
 * - **Target rate** — how often the stimulus repeats what appeared n steps back.
 *   Too low and the session is mostly non-events; too high and guessing "yes"
 *   starts paying off.
 *
 * - **Lure rate** — trials that match n±1 steps back but *not* n. These are the
 *   ones that defeat familiarity-based guessing. Without lures you can score
 *   well on a vague sense of "I've seen that recently"; with them, only actually
 *   tracking position in the sequence works. This is the single most effective
 *   difficulty control in the exercise, which is why it is exposed as a setting.
 *
 * Everything is driven by the seeded RNG so the sequence replays exactly from
 * `(seed, config)` — see PLAN §9.4a.
 */

import type { Rng } from "~/core/rng";

export type Modality = "position" | "audio" | "color" | "shape";

export interface StreamSpec {
  modality: Modality;
  /** Number of distinct stimulus values, e.g. 9 for a 3x3 grid. */
  alphabetSize: number;
}

export interface GenerateOptions {
  n: number;
  trials: number;
  targetRate: number;
  lureRate: number;
  streams: StreamSpec[];
}

export interface TrialStimulus {
  /** Stimulus value per modality, keyed in the same order as `streams`. */
  values: Record<string, number>;
  /** Per-modality: does this trial match the one n steps back? */
  isTarget: Record<string, boolean>;
  /** Per-modality: is this a near-miss at n±1 (and not a real target)? */
  isLure: Record<string, boolean>;
}

/**
 * Trials before index `n` can never be targets — there is nothing n steps back
 * to match. They are presented and answered but excluded from scoring, which is
 * why the UI adds `n` to the requested trial count.
 */
export const eligibleTrialCount = (trials: number, n: number): number => Math.max(0, trials - n);

export function generateSequence(options: GenerateOptions, rng: Rng): TrialStimulus[] {
  const { n, trials, streams } = options;
  if (n < 1) throw new RangeError("n must be >= 1");
  if (trials <= n) throw new RangeError("trials must exceed n");
  if (streams.length === 0) throw new RangeError("at least one stream is required");

  const perStream = streams.map((spec) => generateStream(spec, options, rng));

  return Array.from({ length: trials }, (_, i) => {
    const values: Record<string, number> = {};
    const isTarget: Record<string, boolean> = {};
    const isLure: Record<string, boolean> = {};
    for (let s = 0; s < streams.length; s++) {
      const key = (streams[s] as StreamSpec).modality;
      const stream = perStream[s] as StreamResult;
      values[key] = stream.values[i] as number;
      isTarget[key] = stream.targets.has(i);
      isLure[key] = stream.lures.has(i);
    }
    return { values, isTarget, isLure };
  });
}

interface StreamResult {
  values: number[];
  targets: Set<number>;
  lures: Set<number>;
}

function generateStream(spec: StreamSpec, options: GenerateOptions, rng: Rng): StreamResult {
  const { n, trials, targetRate, lureRate } = options;
  const alphabet = spec.alphabetSize;
  if (alphabet < 2) throw new RangeError("alphabetSize must be >= 2");

  const eligible: number[] = [];
  for (let i = n; i < trials; i++) eligible.push(i);

  // Round rather than floor so a 25% rate over 20 eligible trials gives 5, not 4.
  const targetCount = Math.min(eligible.length, Math.round(eligible.length * targetRate));
  const lureCount = Math.min(eligible.length - targetCount, Math.round(eligible.length * lureRate));

  const shuffled = rng.shuffle(eligible);
  const targets = new Set(shuffled.slice(0, targetCount));
  const lures = new Set(shuffled.slice(targetCount, targetCount + lureCount));

  const values: number[] = new Array(trials);

  for (let i = 0; i < trials; i++) {
    if (i < n) {
      values[i] = rng.int(alphabet);
      continue;
    }

    const backN = values[i - n] as number;

    if (targets.has(i)) {
      values[i] = backN;
      continue;
    }

    if (lures.has(i)) {
      const lureValue = pickLureValue(values, i, n, backN, rng);
      if (lureValue !== null) {
        values[i] = lureValue;
        continue;
      }
      // No usable n±1 neighbour (happens at the very start of the sequence).
      // Demote to an ordinary non-target rather than silently emitting a target.
      lures.delete(i);
    }

    values[i] = pickNonTarget(values, i, n, backN, alphabet, rng);
  }

  // Lures that could not be placed must not stay in the reported set, and any
  // trial that accidentally landed on an n±1 match is reported as a lure so the
  // scoring and the stored trial log agree with what was actually shown.
  const actualLures = new Set<number>();
  for (let i = n; i < trials; i++) {
    if (targets.has(i)) continue;
    if (matchesNeighbour(values, i, n)) actualLures.add(i);
  }

  return { values, targets, lures: actualLures };
}

/** Indices that count as "n±1 back" for lure purposes, skipping i itself. */
function neighbourIndices(i: number, n: number): number[] {
  const candidates = [i - n - 1, i - n + 1];
  return candidates.filter((index) => index >= 0 && index < i);
}

function pickLureValue(
  values: readonly number[],
  i: number,
  n: number,
  backN: number,
  rng: Rng,
): number | null {
  const options = neighbourIndices(i, n)
    .map((index) => values[index] as number)
    // A neighbour that happens to equal the n-back value would make this a real
    // target, which is the opposite of what a lure is for.
    .filter((value) => value !== backN);
  return options.length === 0 ? null : rng.pick(options);
}

function pickNonTarget(
  values: readonly number[],
  i: number,
  n: number,
  backN: number,
  alphabet: number,
  rng: Rng,
): number {
  const neighbours = new Set(neighbourIndices(i, n).map((index) => values[index] as number));

  // Preferred: avoid both the n-back value and the n±1 values, so the trial is
  // unambiguously a non-event.
  const clean: number[] = [];
  const acceptable: number[] = [];
  for (let value = 0; value < alphabet; value++) {
    if (value === backN) continue;
    acceptable.push(value);
    if (!neighbours.has(value)) clean.push(value);
  }

  // With a small alphabet every remaining value may be an n±1 match. Avoiding a
  // real target is mandatory; avoiding an accidental lure is best-effort.
  const pool = clean.length > 0 ? clean : acceptable;
  return rng.pick(pool);
}

function matchesNeighbour(values: readonly number[], i: number, n: number): boolean {
  const value = values[i] as number;
  return neighbourIndices(i, n).some((index) => values[index] === value);
}
