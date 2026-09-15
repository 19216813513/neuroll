/**
 * High-score filtering and ranking (PLAN §7.2, view 1).
 *
 * The premise of the screen is that a score only means something together with
 * the settings it was measured under, so every difficulty setting becomes its own
 * filter, generated from the exercise's `SettingDef[]` rather than hand-written
 * per exercise. Adding a setting to an exercise therefore adds a filter here for
 * free, and the three places a setting has to agree — the form, the bucket, the
 * leaderboard — cannot drift apart.
 *
 * Everything in this module is pure and DOM-free so the rules are testable
 * without rendering anything.
 */

import type { ExerciseDef, SettingDef } from "~/exercises/types";
import type { Run } from "~/store/types";
import { formatSettingValue, settingValueKey } from "./bucket";

/** Sentinel for "do not filter on this setting". */
export const ANY = "__any__";

export type Period = "all" | "today" | "7d" | "30d";

export interface FilterState {
  /** Difficulty setting key → canonical value key, or ANY. */
  settings: Record<string, string>;
  /** Device class, or ANY. */
  device: string;
  period: Period;
  /**
   * Invalid runs are excluded by default and can be shown deliberately. They are
   * never ranked against valid ones — a run interrupted by a tab switch has a
   * plausible-looking score, and mixing it in would put a bogus number at the top
   * of the table permanently.
   */
  includeInvalid: boolean;
}

export interface FilterOption {
  value: string;
  label: string;
  /** How many runs in the history carry this value. */
  count: number;
}

/** The difficulty settings, which are exactly the ones that make a bucket. */
export function filterableSettings(def: ExerciseDef): SettingDef[] {
  return def.settings.filter((setting) => setting.affects === "difficulty");
}

/**
 * Starts from the config currently in hand, as PLAN §7.2 specifies: the default
 * view is "records played exactly like this", and widening is one click per
 * setting. Starting wide instead would open on a table mixing conditions that
 * are not comparable, which is the thing this screen exists to prevent.
 */
export function defaultFilters(def: ExerciseDef, config: Record<string, unknown>): FilterState {
  const settings: Record<string, string> = {};
  for (const setting of filterableSettings(def)) {
    settings[setting.key] = settingValueKey(setting, config[setting.key]);
  }
  return { settings, device: ANY, period: "all", includeInvalid: false };
}

/**
 * The values a setting actually takes in the history.
 *
 * Only values that were really played are offered. A dropdown listing N=1..9
 * when six of them have never been attempted is a list of dead ends; this way
 * every option in the filter leads somewhere.
 */
export function optionsFor(runs: readonly Run[], setting: SettingDef): FilterOption[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const run of runs) {
    const value = run.configSnapshot[setting.key];
    const key = settingValueKey(setting, value);
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { label: formatSettingValue(setting, value), count: 1 });
  }
  return [...counts.entries()]
    .map(([value, { label, count }]) => ({ value, label, count }))
    .sort(compareOptions);
}

export function deviceOptions(runs: readonly Run[]): FilterOption[] {
  const counts = new Map<string, number>();
  for (const run of runs) {
    const key = run.deviceProfile.deviceClass;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: value, count }))
    .sort(compareOptions);
}

/**
 * Numeric-aware ordering, so a slider's values read 15, 30, 60, 120 rather than
 * the 120, 15, 30, 60 that string ordering would produce.
 */
function compareOptions(a: FilterOption, b: FilterOption): number {
  const left = Number(a.value.replace(/"/g, ""));
  const right = Number(b.value.replace(/"/g, ""));
  if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}

/** Inclusive lower bound for a period, or null for "all time". */
export function periodStart(period: Period, now: number): number | null {
  if (period === "all") return null;
  if (period === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }
  const days = period === "7d" ? 7 : 30;
  return now - days * 24 * 60 * 60 * 1000;
}

export function applyFilters(
  def: ExerciseDef,
  runs: readonly Run[],
  filters: FilterState,
  now: number,
): Run[] {
  const from = periodStart(filters.period, now);
  const settings = filterableSettings(def);

  return runs.filter((run) => {
    if (run.exerciseId !== def.id) return false;
    if (run.deletedAt !== undefined) return false;
    if (!filters.includeInvalid && !run.valid) return false;
    if (filters.device !== ANY && run.deviceProfile.deviceClass !== filters.device) return false;
    if (from !== null && run.startedAt < from) return false;

    for (const setting of settings) {
      const wanted = filters.settings[setting.key];
      if (wanted === undefined || wanted === ANY) continue;
      if (settingValueKey(setting, run.configSnapshot[setting.key]) !== wanted) return false;
    }
    return true;
  });
}

export interface RankedRun {
  /** Competition ranking: equal scores share a rank and the next one is skipped. */
  rank: number;
  run: Run;
}

export function rankRuns(runs: readonly Run[], higherIsBetter: boolean): RankedRun[] {
  const sorted = [...runs].sort((a, b) => {
    if (a.primaryScore !== b.primaryScore) {
      return higherIsBetter ? b.primaryScore - a.primaryScore : a.primaryScore - b.primaryScore;
    }
    // On a tie the earlier run ranks higher: it got there first.
    return a.startedAt - b.startedAt;
  });

  const ranked: RankedRun[] = [];
  let rank = 0;
  let previous: number | null = null;
  sorted.forEach((run, index) => {
    if (previous === null || run.primaryScore !== previous) rank = index + 1;
    previous = run.primaryScore;
    ranked.push({ rank, run });
  });
  return ranked;
}

/**
 * The one setting left open, when exactly one is.
 *
 * PLAN §7.2 calls this the free axis: widening a single setting turns the table
 * from "my best runs at this exact condition" into "my best at each value of
 * this setting" — the N=1..5 ladder, in one view. Two open settings have no such
 * reading, so the table stays a plain ranking.
 */
export function freeAxis(def: ExerciseDef, filters: FilterState): SettingDef | null {
  const open = filterableSettings(def).filter(
    (setting) => (filters.settings[setting.key] ?? ANY) === ANY,
  );
  return open.length === 1 ? (open[0] as SettingDef) : null;
}

export interface AxisGroup {
  /** Canonical value key, for stable React keys. */
  value: string;
  label: string;
  best: Run;
  count: number;
}

/** Personal best at each value of the free axis, ordered along the axis. */
export function groupByAxis(
  runs: readonly Run[],
  axis: SettingDef,
  higherIsBetter: boolean,
): AxisGroup[] {
  const groups = new Map<string, Run[]>();
  for (const run of runs) {
    const key = settingValueKey(axis, run.configSnapshot[axis.key]);
    const list = groups.get(key) ?? [];
    list.push(run);
    groups.set(key, list);
  }

  return [...groups.entries()]
    .map(([value, list]) => {
      const best = rankRuns(list, higherIsBetter)[0] as RankedRun;
      return {
        value,
        label: formatSettingValue(axis, best.run.configSnapshot[axis.key]),
        best: best.run,
        count: list.length,
      };
    })
    .sort((a, b) => compareOptions({ ...a, count: 0 }, { ...b, count: 0 }));
}
