/**
 * Export and import.
 *
 * The realistic way to lose everything here is not a bug — it is the browser
 * clearing site data, which happens without warning and takes the whole history
 * with it. Export is therefore a first-class feature, not a nicety, and it lands
 * before any sync exists.
 *
 * Import merges by union on run id. Runs are immutable once written, so two
 * databases can be combined without conflict resolution.
 */

import { getDb } from "./db";
import type { MetaRecord, Preset, Run, StoredSettings, Trial } from "./types";
import { SCHEMA_VERSION } from "./types";

export interface BackupFile {
  format: "neuroll-backup";
  schemaVersion: number;
  exportedAt: number;
  appVersion: string;
  runs: Run[];
  trials: Trial[];
  settings: StoredSettings[];
  presets: Preset[];
  meta: MetaRecord[];
}

export async function exportAll(appVersion: string): Promise<BackupFile> {
  const db = await getDb();
  const [runs, trials, settings, presets, meta] = await Promise.all([
    db.getAll("runs"),
    db.getAll("trials"),
    db.getAll("settings"),
    db.getAll("presets"),
    db.getAll("meta"),
  ]);
  return {
    format: "neuroll-backup",
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    appVersion,
    runs,
    trials,
    settings,
    presets,
    meta,
  };
}

export interface ImportResult {
  runsAdded: number;
  runsSkipped: number;
  trialsAdded: number;
}

export function validateBackup(data: unknown): asserts data is BackupFile {
  if (typeof data !== "object" || data === null) throw new Error("バックアップの形式が不正です");
  const file = data as Partial<BackupFile>;
  if (file.format !== "neuroll-backup") {
    throw new Error("neuroll のバックアップファイルではありません");
  }
  if (typeof file.schemaVersion !== "number") throw new Error("schemaVersion がありません");
  if (file.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `新しいバージョン (v${file.schemaVersion}) のバックアップです。アプリを更新してください`,
    );
  }
  if (!Array.isArray(file.runs)) throw new Error("runs がありません");
}

/**
 * Merges a backup into the current database.
 * Existing runs win on id collision — re-importing the same file is a no-op.
 */
export async function importBackup(data: unknown): Promise<ImportResult> {
  validateBackup(data);
  const db = await getDb();
  const existingIds = new Set(await db.getAllKeys("runs"));

  const newRuns = data.runs.filter((run) => !existingIds.has(run.id));
  const newRunIds = new Set(newRuns.map((run) => run.id));
  const newTrials = (data.trials ?? []).filter((trial) => newRunIds.has(trial.runId));

  const tx = db.transaction(["runs", "trials", "settings", "presets", "meta"], "readwrite");
  await Promise.all([
    ...newRuns.map((run) => tx.objectStore("runs").put(run)),
    ...newTrials.map((trial) => tx.objectStore("trials").put(trial)),
    // Settings and presets are last-write-wins by updatedAt.
    ...(data.settings ?? []).map(async (incoming) => {
      const store = tx.objectStore("settings");
      const current = await store.get(incoming.exerciseId);
      if (!current || current.updatedAt < incoming.updatedAt) await store.put(incoming);
    }),
    ...(data.presets ?? []).map(async (incoming) => {
      const store = tx.objectStore("presets");
      const current = await store.get(incoming.id);
      if (!current || current.updatedAt < incoming.updatedAt) await store.put(incoming);
    }),
  ]);
  await tx.done;

  return {
    runsAdded: newRuns.length,
    runsSkipped: data.runs.length - newRuns.length,
    trialsAdded: newTrials.length,
  };
}

/** Flattens runs to CSV for analysis outside the app. */
export function runsToCsv(runs: readonly Run[]): string {
  const metricKeys = [...new Set(runs.flatMap((run) => Object.keys(run.metrics)))].sort();
  const header = [
    "id",
    "exerciseId",
    "scoreBucket",
    "startedAt",
    "startedAtIso",
    "durationMs",
    "primaryScore",
    "valid",
    "suspicion",
    "deviceClass",
    "refreshRateHz",
    "note",
    ...metricKeys,
  ];

  const escapeCell = (value: unknown): string => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const rows = runs.map((run) =>
    [
      run.id,
      run.exerciseId,
      run.scoreBucket,
      run.startedAt,
      new Date(run.startedAt).toISOString(),
      Math.round(run.durationMs),
      run.primaryScore,
      run.valid,
      run.suspicion.join("|"),
      run.deviceProfile.deviceClass,
      run.deviceProfile.refreshRateHz,
      run.note ?? "",
      ...metricKeys.map((key) => run.metrics[key] ?? ""),
    ].map(escapeCell),
  );

  return [header.join(","), ...rows.map((row) => row.join(","))].join("\n");
}

export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
