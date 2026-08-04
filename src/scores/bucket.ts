/**
 * Score buckets.
 *
 * A bucket identifies "records that are fair to compare against each other".
 * It is derived from the exercise, its difficulty settings, and — for timing
 * sensitive exercises — the device class.
 *
 * The hash must stay stable forever: it is written into every stored run, and a
 * change would sever every record from its history. Hence explicit key sorting
 * and explicit value normalisation rather than relying on `JSON.stringify` object
 * ordering, which is only guaranteed for string keys in insertion order.
 *
 * PLAN §7.1 specified SHA-256. This uses a 128-bit synchronous hash instead:
 * `crypto.subtle.digest` is async, and bucket ids are needed inside render paths
 * and sort comparators where awaiting is impractical. Collision resistance
 * against an adversary is not required here — only stability — and at 128 bits
 * an accidental collision across a lifetime of buckets is not a real risk.
 */

import type { Config, ExerciseDef, SettingDef } from "~/exercises/types";

/** Bump only if the hashing scheme itself changes. Invalidates all buckets. */
export const BUCKET_SCHEME_VERSION = 1;

/**
 * Canonicalises a setting value so equivalent configs hash identically.
 * Numbers are rounded to 6 decimals because floating point can otherwise render
 * the same slider position as 2500 and 2500.0000000000005.
 */
function normalizeValue(setting: SettingDef, value: unknown): unknown {
  switch (setting.kind) {
    case "int":
    case "ms": {
      const n = typeof value === "number" ? value : Number(value);
      return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : setting.default;
    }
    case "bool":
      return value === true;
    case "multi": {
      // Order must not matter: ["audio","position"] is the same task as reversed.
      const list = Array.isArray(value) ? value.map(String) : [];
      return [...new Set(list)].sort();
    }
    default:
      return value === undefined || value === null ? setting.default : String(value);
  }
}

/** The difficulty-relevant subset of a config, canonically ordered. */
export function difficultyProjection(def: ExerciseDef, config: Config): [string, unknown][] {
  return def.settings
    .filter((setting) => setting.affects === "difficulty")
    .map(
      (setting) => [setting.key, normalizeValue(setting, config[setting.key])] as [string, unknown],
    )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * 64-bit FNV-1a with an extra avalanche step, returned as 16 hex chars.
 * Plain FNV-1a alone clusters badly on similar short strings; the final mix
 * spreads those apart.
 */
function hash64(input: string, seed: bigint): string {
  const PRIME = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  let h = seed;
  for (let i = 0; i < input.length; i++) {
    h = ((h ^ BigInt(input.charCodeAt(i))) * PRIME) & MASK;
  }
  // Avalanche (splitmix64 finaliser).
  h = ((h ^ (h >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
  h = ((h ^ (h >> 27n)) * 0x94d049bb133111ebn) & MASK;
  h = (h ^ (h >> 31n)) & MASK;
  return h.toString(16).padStart(16, "0");
}

/** 128-bit stable hash: two independent 64-bit passes concatenated. */
export function stableHash(input: string): string {
  return hash64(input, 0xcbf29ce484222325n) + hash64(input, 0x9e3779b97f4a7c15n);
}

export interface BucketInput {
  def: ExerciseDef;
  config: Config;
  /** Required only when `def.timingSensitive`. */
  deviceClass?: string;
}

export function computeBucket({ def, config, deviceClass }: BucketInput): string {
  const payload = JSON.stringify({
    v: BUCKET_SCHEME_VERSION,
    e: def.id,
    bv: def.bucketVersion,
    d: difficultyProjection(def, config),
    // Only timing-sensitive exercises are device-partitioned. Folding device into
    // every bucket would needlessly split, say, a Schulte completion time that is
    // dominated by search speed rather than by input latency.
    dc: def.timingSensitive ? (deviceClass ?? "unknown") : null,
  });
  return stableHash(payload);
}

/** Short prefix for display and debugging. Never used as an identity. */
export const shortBucket = (bucket: string): string => bucket.slice(0, 8);

/**
 * Human-readable summary of what makes a bucket distinct, e.g. "N=3 / ISI 2500ms".
 * Used as the row label in the high-score views.
 */
export function describeBucket(def: ExerciseDef, config: Config): string {
  const parts: string[] = [];
  for (const setting of def.settings) {
    if (setting.affects !== "difficulty") continue;
    const value = config[setting.key];
    if (setting.kind === "bool") {
      if (value === true) parts.push(setting.label);
      continue;
    }
    if (setting.kind === "multi") {
      const list = Array.isArray(value) ? value : [];
      if (list.length > 0) {
        const labels = list.map(
          (v) => setting.options.find((o) => o.value === v)?.label ?? String(v),
        );
        parts.push(labels.join("+"));
      }
      continue;
    }
    if (setting.kind === "enum") {
      const label = setting.options.find((o) => o.value === value)?.label;
      if (label) parts.push(label);
      continue;
    }
    const unit = "unit" in setting && setting.unit ? setting.unit : "";
    parts.push(`${setting.label} ${value}${unit}`);
  }
  return parts.join(" / ") || "既定";
}

/**
 * Whether two configs are close enough for a greyed-out reference comparison.
 * Enum, bool and multi settings must match exactly; numeric ones may differ
 * within their declared tolerance. Used only for context — never for a PB.
 */
export function isWithinTolerance(def: ExerciseDef, a: Config, b: Config): boolean {
  for (const setting of def.settings) {
    if (setting.affects !== "difficulty") continue;
    const left = normalizeValue(setting, a[setting.key]);
    const right = normalizeValue(setting, b[setting.key]);

    if (setting.kind === "int" || setting.kind === "ms") {
      const tolerance = setting.tolerance ?? 0;
      const l = left as number;
      const r = right as number;
      if (tolerance === 0) {
        if (l !== r) return false;
      } else if (Math.abs(l - r) > Math.abs(l) * tolerance) {
        return false;
      }
    } else if (JSON.stringify(left) !== JSON.stringify(right)) {
      return false;
    }
  }
  return true;
}
