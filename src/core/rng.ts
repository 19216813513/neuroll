/**
 * Seeded deterministic PRNG.
 *
 * Every stimulus sequence in the app is generated from a recorded seed, so that
 * `(seed, config)` can reconstruct the exact sequence later. That is what makes a
 * run re-scorable — by a future server, or by us when auditing our own data.
 *
 * Because of that, this file is effectively frozen once runs exist: changing the
 * algorithm silently invalidates every stored run's reproducibility. If it ever
 * has to change, add a new algorithm alongside and bump `RNG_VERSION`, keeping
 * the old one for replaying old runs.
 *
 * Algorithm: xoshiro128** — small, fast, and passes the usual statistical suites.
 * `Math.random()` is deliberately not used anywhere in the app: it cannot be seeded.
 */

export const RNG_VERSION = 1;

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Uniform integer in [min, max] inclusive. */
  range(min: number, max: number): number;
  /** True with the given probability (0..1). */
  chance(probability: number): boolean;
  /** Uniformly picks one element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T;
  /** Returns a new shuffled array (Fisher-Yates). Does not mutate the input. */
  shuffle<T>(items: readonly T[]): T[];
}

/**
 * Expands an arbitrary string seed into four 32-bit words of state.
 * Uses a MurmurHash3-style mixer so that seeds differing by one character
 * produce completely unrelated streams.
 */
function seedState(seed: string): [number, number, number, number] {
  let h = 0x9e3779b9 ^ seed.length;
  const state: number[] = [];
  for (let word = 0; word < 4; word++) {
    for (let i = 0; i < seed.length; i++) {
      h = Math.imul(h ^ seed.charCodeAt(i), 0x5bd1e995);
      h ^= h >>> 15;
    }
    // Keep mixing even for short seeds so all four words are well separated.
    h = Math.imul(h ^ (word + 0x6d2b79f5), 0x85ebca6b);
    h ^= h >>> 13;
    state.push(h >>> 0);
  }
  // All-zero state is a fixed point for xoshiro; nudge it if we land there.
  if (state.every((w) => w === 0)) return [1, 2, 3, 4];
  return state as [number, number, number, number];
}

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

export function createRng(seed: string): Rng {
  const [a, b, c, d] = seedState(seed);
  let s0 = a;
  let s1 = b;
  let s2 = c;
  let s3 = d;

  const nextUint32 = (): number => {
    const result = (Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl(s3, 11);
    return result;
  };

  // Discard the first few outputs so poorly-separated seeds diverge before use.
  for (let i = 0; i < 8; i++) nextUint32();

  const next = (): number => nextUint32() / 4294967296;

  const int = (maxExclusive: number): number => {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError(`int() needs a positive integer bound, got ${maxExclusive}`);
    }
    return Math.floor(next() * maxExclusive);
  };

  return {
    next,
    int,
    range: (min, max) => {
      if (max < min) throw new RangeError(`range() needs max >= min, got ${min}..${max}`);
      return min + int(max - min + 1);
    },
    chance: (probability) => next() < probability,
    pick: (items) => {
      if (items.length === 0) throw new RangeError("pick() needs a non-empty array");
      return items[int(items.length)] as (typeof items)[number];
    },
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [out[i], out[j]] = [out[j] as (typeof out)[number], out[i] as (typeof out)[number]];
      }
      return out;
    },
  };
}

/**
 * Creates a fresh unpredictable seed for a new run.
 * Uses crypto when available so two runs started in the same millisecond differ.
 */
export function newSeed(): string {
  const bytes = new Uint8Array(10);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Non-browser fallback (tests, SSR). Never reached in the app.
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
