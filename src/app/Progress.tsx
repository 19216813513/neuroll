/**
 * Progress screen — the learning curve (PLAN §10).
 *
 * Phase 1 scope is the curve alone: raw runs plus a trailing ten-run average,
 * per exercise and per bucket. The radar, the hour-of-day heatmap and ceiling
 * detection are phase 2 and deliberately absent.
 *
 * Everything here is drawn per bucket rather than per exercise. A curve mixing
 * N=2 and N=4 runs would trend downward every time the difficulty was raised,
 * which is the exact opposite of what happened.
 */

import { useEffect, useMemo, useState } from "preact/hooks";
import { exercises } from "~/exercises/registry";
import type { ExerciseDef } from "~/exercises/types";
import { distinguishLabels } from "~/scores/bucket";
import { linearSlope, movingAverage } from "~/stats/descriptive";
import { queryRuns, summariseBucket } from "~/store/runs";
import type { Run } from "~/store/types";
import type { Point } from "~/ui/chart";
import { formatDateTime, trendArrow } from "~/ui/format";
import { LineChart } from "~/ui/LineChart";

/** Window for the smoothed line, per PLAN §10. */
const AVERAGE_WINDOW = 10;

interface Props {
  onHome: () => void;
}

export function Progress({ onHome }: Props) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [exerciseId, setExerciseId] = useState<string | null>(null);
  const [bucket, setBucket] = useState<string | null>(null);

  useEffect(() => {
    void queryRuns().then(setRuns);
  }, []);

  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onHome();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onHome]);

  // Exercises with something to plot, most recently played first: opening on an
  // exercise that has never been run would show an empty chart by default.
  const played = useMemo(() => {
    if (!runs) return [];
    const lastPlayed = new Map<string, number>();
    for (const run of runs) {
      lastPlayed.set(run.exerciseId, Math.max(lastPlayed.get(run.exerciseId) ?? 0, run.startedAt));
    }
    return exercises
      .filter((def) => lastPlayed.has(def.id))
      .sort((a, b) => (lastPlayed.get(b.id) ?? 0) - (lastPlayed.get(a.id) ?? 0));
  }, [runs]);

  const def: ExerciseDef | undefined =
    played.find((candidate) => candidate.id === exerciseId) ?? played[0];

  const buckets = useMemo(() => {
    if (!runs || !def) return [];
    const grouped = new Map<string, Run[]>();
    for (const run of runs) {
      if (run.exerciseId !== def.id) continue;
      const list = grouped.get(run.scoreBucket) ?? [];
      list.push(run);
      grouped.set(run.scoreBucket, list);
    }
    const entries = [...grouped.entries()].map(([id, list]) => ({
      id,
      list,
      lastPlayedAt: Math.max(...list.map((run) => run.startedAt)),
    }));

    // Named by what separates them, so the buttons are readable rather than five
    // copies of the same sentence.
    const labels = distinguishLabels(
      def,
      entries.map((entry) => (entry.list[0] as Run).configSnapshot),
    );
    // Two buckets can share every setting and still be different records: a
    // timing-sensitive exercise partitions by device class, which lives outside
    // the config. Without this they would be two identical-looking buttons.
    const collides = new Set(labels.filter((label, index) => labels.indexOf(label) !== index));

    return entries
      .map((entry, index) => {
        const label = labels[index] as string;
        const deviceClass = (entry.list[0] as Run).deviceProfile.deviceClass;
        return {
          ...entry,
          label: collides.has(label) ? `${label}（${deviceClass}）` : label,
        };
      })
      .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
  }, [runs, def]);

  const selected = buckets.find((candidate) => candidate.id === bucket) ?? buckets[0];
  const primary = def?.metrics.find((metric) => metric.key === def.primaryMetric);
  const precision = primary?.precision ?? 0;

  const series = useMemo(() => {
    if (!selected) return { points: [] as Point[], average: [] as Point[], runs: [] as Run[] };
    // Oldest first: a learning curve reads left to right in time, while every
    // query in the store hands back newest first.
    const ordered = [...selected.list].sort((a, b) => a.startedAt - b.startedAt);
    const scores = ordered.map((run) => run.primaryScore);
    return {
      runs: ordered,
      points: scores.map((y, x) => ({ x, y })),
      average: movingAverage(scores, AVERAGE_WINDOW).map((y, x) => ({ x, y })),
    };
  }, [selected]);

  const summary = selected && def ? summariseBucket(selected.list, def.higherIsBetter) : null;
  const slope = linearSlope(series.points.slice(-10).map((point) => point.y));

  return (
    <div class="app-shell">
      <header class="app-header">
        <h1 class="app-title">進捗</h1>
        <button type="button" onClick={onHome}>
          ホーム <kbd>Esc</kbd>
        </button>
      </header>

      {runs === null && <p class="muted">読み込み中…</p>}

      {runs !== null && played.length === 0 && (
        <div class="card">
          <p class="muted">
            まだ記録がありません。1回でも種目を実行すると、ここに学習曲線が出ます。
          </p>
        </div>
      )}

      {def && selected && (
        <>
          <div class="card">
            <div class="settings-legend">種目</div>
            <div class="row">
              {played.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  class={candidate.id === def.id ? "preset is-active" : "preset"}
                  onClick={() => {
                    setExerciseId(candidate.id);
                    // The previous bucket belongs to the previous exercise; keeping
                    // it would fall through to an unrelated default.
                    setBucket(null);
                  }}
                >
                  {candidate.name}
                </button>
              ))}
            </div>

            <div class="settings-legend" style="margin-top: var(--s-4)">
              設定（この条件の記録だけを描画）
            </div>
            <div class="row">
              {buckets.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  class={candidate.id === selected.id ? "preset is-active" : "preset"}
                  onClick={() => setBucket(candidate.id)}
                >
                  <span>{candidate.label}</span>
                  <span class="faint">{candidate.list.length} 回</span>
                </button>
              ))}
            </div>
          </div>

          <div class="card" style="margin-top: var(--s-4)">
            <div class="row" style="justify-content: space-between; align-items: baseline">
              <h2 class="section-title" style="margin: 0">
                {primary?.label ?? def.primaryMetric}
                {primary?.unit ? <span class="faint"> ({primary.unit})</span> : null}
              </h2>
              <span class="faint">実線 = 各回 / 太線 = 直近{AVERAGE_WINDOW}回の移動平均</span>
            </div>

            <LineChart
              points={series.points}
              average={series.average}
              formatValue={(value) => value.toFixed(precision)}
              formatPoint={(index) => {
                const run = series.runs[index];
                if (!run) return `${index + 1} 回目`;
                return `${index + 1} 回目 ・ ${formatDateTime(run.startedAt)}`;
              }}
            />
          </div>

          {summary && (
            <div class="card" style="margin-top: var(--s-4)">
              <div class="metric-grid">
                <div class="metric">
                  <span class="metric-label">自己ベスト</span>
                  <span class="metric-value">{summary.best.toFixed(precision)}</span>
                </div>
                <div class="metric">
                  <span class="metric-label">直近5回平均</span>
                  <span class="metric-value">{summary.recentMean.toFixed(precision)}</span>
                </div>
                <div class="metric">
                  <span class="metric-label">記録数</span>
                  <span class="metric-value">{summary.count}</span>
                </div>
                <div class="metric">
                  <span class="metric-label">トレンド</span>
                  <span class="metric-value">
                    {summary.count < 3 ? "—" : trendArrow(slope, def.higherIsBetter)}
                  </span>
                </div>
                <div class="metric">
                  <span class="metric-label">最終実施</span>
                  <span class="metric-value" style="font-size: 1rem">
                    {formatDateTime(summary.lastPlayedAt)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
