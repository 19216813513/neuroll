/**
 * Exercise definitions.
 *
 * An exercise declares its settings as data rather than building a settings
 * screen. The form UI, the score bucket, and the high-score filters are all
 * generated from this schema, so adding an exercise means adding one directory
 * and one registry line — the extensibility target in PLAN §13.
 */

import type { DeviceProfile } from "~/core/deviceProfile";
import type { Rng } from "~/core/rng";

export type CognitiveDomain =
  | "working-memory"
  | "processing-speed"
  | "inhibition"
  | "flexibility"
  | "visuospatial";

/**
 * Whether a setting changes the challenge or only the presentation.
 *
 * This split is what keeps personal bests meaningful. Difficulty settings enter
 * the score bucket, so a record set at N=2 never competes with one at N=3.
 * Cosmetic settings do not, so changing the colour scheme does not orphan the
 * entire history.
 */
export type SettingAffects = "difficulty" | "cosmetic";

interface BaseSetting {
  key: string;
  label: string;
  /** One line explaining what changes. Shown as a tooltip. */
  help?: string;
  affects: SettingAffects;
  /** Advanced settings collapse behind a disclosure. */
  advanced?: boolean;
  /**
   * Hides the control when it cannot do anything given the rest of the config.
   * A setting that is adjustable but inert is worse than a missing one: it
   * silently promises behaviour the session will not deliver.
   */
  visibleWhen?: (config: Config) => boolean;
}

export interface NumberSetting extends BaseSetting {
  kind: "int" | "ms";
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
  /**
   * Relative slack for the "近い設定" reference comparison in PLAN §7.2.
   * 0.1 means records within ±10% may be shown greyed out for context. Reference
   * records never affect a personal best.
   */
  tolerance?: number;
}

export interface EnumSetting extends BaseSetting {
  kind: "enum";
  options: { value: string; label: string }[];
  default: string;
}

export interface MultiSetting extends BaseSetting {
  kind: "multi";
  options: { value: string; label: string }[];
  default: string[];
}

export interface BoolSetting extends BaseSetting {
  kind: "bool";
  default: boolean;
}

export interface KeySetting extends BaseSetting {
  kind: "key";
  default: string;
}

export type SettingDef = NumberSetting | EnumSetting | MultiSetting | BoolSetting | KeySetting;

export type Config = Record<string, unknown>;

export interface MetricDef {
  key: string;
  label: string;
  unit?: string;
  /** Decimal places for display. */
  precision?: number;
  higherIsBetter: boolean;
}

export interface TrialRecord {
  i: number;
  stimulus: unknown;
  isTarget: boolean;
  response: unknown | null;
  correct: boolean | null;
  rtMs: number | null;
  presentedAt: number;
}

export interface RunResult {
  metrics: Record<string, number>;
  primaryScore: number;
  trials: TrialRecord[];
  durationMs: number;
  /** Set when the session could not be completed cleanly. */
  aborted?: boolean;
}

export interface SessionContext {
  config: Config;
  rng: Rng;
  seed: string;
  deviceProfile: DeviceProfile;
  /** Host element the exercise renders into. Cleared for it beforehand. */
  root: HTMLElement;
  signal: AbortSignal;
  /** Reports 0..1 progress so the shell can show a bar if enabled. */
  onProgress?: (fraction: number) => void;
}

export interface ExercisePreset {
  name: string;
  /** Only the keys that differ from the defaults. */
  config: Config;
  /** Shown under the name so the tradeoff is visible before selecting. */
  note?: string;
}

export interface ExerciseDef {
  id: string;
  name: string;
  /** One sentence on what it trains. */
  blurb: string;
  /**
   * How to play, in order. Shown on the setup screen before the first run.
   * An exercise nobody can figure out trains nothing, so this is required
   * rather than optional.
   */
  instructions: string[];
  /** Named difficulty starting points, easiest first. */
  presets: ExercisePreset[];
  domains: CognitiveDomain[];
  /** Bump when stimulus generation or scoring changes; isolates old records. */
  bucketVersion: number;
  settings: SettingDef[];
  metrics: MetricDef[];
  primaryMetric: string;
  /** True when a larger primary metric is better (d-prime), false for times. */
  higherIsBetter: boolean;
  /** True when reaction time dominates, so deviceClass joins the bucket. */
  timingSensitive: boolean;
  /**
   * The response keys actually in play for a given config, so the setup screen
   * and the session can state them instead of leaving the participant guessing.
   */
  keyHints?: (config: Config) => { key: string; label: string }[];
  run: (ctx: SessionContext) => Promise<RunResult>;
}

/** Builds the default config from a definition's declared defaults. */
export function defaultConfig(def: ExerciseDef): Config {
  const config: Config = {};
  for (const setting of def.settings) config[setting.key] = setting.default;
  return config;
}

/**
 * Fills in any settings missing from a stored config.
 * Without this, adding a setting to an existing exercise would leave every
 * returning user with an undefined value for it.
 */
export function withDefaults(def: ExerciseDef, stored: Config | null): Config {
  const config = defaultConfig(def);
  if (!stored) return config;
  for (const setting of def.settings) {
    if (setting.key in stored) config[setting.key] = stored[setting.key];
  }
  return config;
}
