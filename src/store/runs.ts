/**
 * Run persistence and the queries the UI reads scores from.
 *
 * Every read path filters out invalid and deleted runs by default. That default
 * matters: a run interrupted by a tab switch has a plausible-looking score, and
 * if it leaked into a personal best it would sit at the top of the leaderboard
 * forever with no way for the user to tell it was bogus.
 */

import { getDb } from "./db";
import type { Run, Trial } from "./types";

export interface RunQuery {
  exerciseId?: string;
  scoreBucket?: string;
  /** Inclusive wall-clock bounds. */
  from?: number;
  to?: number;
  includeInvalid?: boolean;
  includeDeleted?: boolean;
}

export async function saveRun(run: Run, trials: Trial[] = []): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["runs", "trials"], "readwrite");
  await tx.objectStore("runs").put(run);
  const trialStore = tx.objectStore("trials");
  // Written in the same transaction so a crash cannot leave a run without its
  // trials — which would make it unverifiable and therefore worthless.
  await Promise.all(trials.map((trial) => trialStore.put(trial)));
  await tx.done;
}

function matches(run: Run, query: RunQuery): boolean {
  if (!query.includeDeleted && run.deletedAt !== undefined) return false;
  if (!query.includeInvalid && !run.valid) return false;
  if (query.exerciseId && run.exerciseId !== query.exerciseId) return false;
  if (query.scoreBucket && run.scoreBucket !== query.scoreBucket) return false;
  if (query.from !== undefined && run.startedAt < query.from) return false;
  if (query.to !== undefined && run.startedAt > query.to) return false;
  return true;
}

/** Returns matching runs, newest first. */
export async function queryRuns(query: RunQuery = {}): Promise<Run[]> {
  const db = await getDb();

  // Narrow with an index when we can; a full scan only happens for broad queries.
  let candidates: Run[];
  if (query.scoreBucket) {
    candidates = await db.getAllFromIndex("runs", "by-bucket", query.scoreBucket);
  } else if (query.exerciseId) {
    candidates = await db.getAllFromIndex("runs", "by-exercise", query.exerciseId);
  } else {
    candidates = await db.getAll("runs");
  }

  return candidates.filter((run) => matches(run, query)).sort((a, b) => b.startedAt - a.startedAt);
}

export async function getRun(id: string): Promise<Run | undefined> {
  return (await getDb()).get("runs", id);
}

export async function getTrials(runId: string): Promise<Trial[]> {
  const db = await getDb();
  const trials = await db.getAllFromIndex("trials", "by-run", runId);
  return trials.sort((a, b) => a.i - b.i);
}

/** Logical delete. The row stays so a future sync sees the tombstone. */
export async function softDeleteRun(id: string): Promise<void> {
  const db = await getDb();
  const run = await db.get("runs", id);
  if (!run) return;
  const now = Date.now();
  await db.put("runs", { ...run, deletedAt: now, updatedAt: now });
}

export async function setRunNote(id: string, note: string): Promise<void> {
  const db = await getDb();
  const run = await db.get("runs", id);
  if (!run) return;
  await db.put("runs", { ...run, note, updatedAt: Date.now() });
}

export interface BucketSummary {
  scoreBucket: string;
  exerciseId: string;
  count: number;
  best: number;
  /** Mean of the most recent five — the "current ability" figure from PLAN §7.3. */
  recentMean: number;
  lastPlayedAt: number;
  firstPlayedAt: number;
}

/**
 * Summarises one bucket. `higherIsBetter` comes from the exercise definition
 * because "best" means the maximum for d-prime and the minimum for a completion
 * time, and getting that backwards would invert every personal best.
 */
export function summariseBucket(runs: Run[], higherIsBetter: boolean): BucketSummary | null {
  if (runs.length === 0) return null;
  const first = runs[0] as Run;
  const scores = runs.map((r) => r.primaryScore);
  const best = higherIsBetter ? Math.max(...scores) : Math.min(...scores);

  const byRecency = [...runs].sort((a, b) => b.startedAt - a.startedAt);
  const recent = byRecency.slice(0, 5).map((r) => r.primaryScore);
  const recentMean = recent.reduce((sum, v) => sum + v, 0) / recent.length;

  const times = runs.map((r) => r.startedAt);
  return {
    scoreBucket: first.scoreBucket,
    exerciseId: first.exerciseId,
    count: runs.length,
    best,
    recentMean,
    lastPlayedAt: Math.max(...times),
    firstPlayedAt: Math.min(...times),
  };
}

/** True when `score` beats every score in `previous`. Ties do not count. */
export function isPersonalBest(
  score: number,
  previous: readonly Run[],
  higherIsBetter: boolean,
): boolean {
  if (previous.length === 0) return true;
  const scores = previous.map((r) => r.primaryScore);
  return higherIsBetter ? score > Math.max(...scores) : score < Math.min(...scores);
}
