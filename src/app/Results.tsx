/**
 * Results screen.
 *
 * Shows the personal best and the recent-five mean at equal weight, per PLAN
 * §7.3. Displaying only the PB makes every ordinary session read as a failure,
 * which is the fastest way to stop training.
 *
 * Retry is the primary action and the focus is already on it: Space or R restarts
 * with identical settings and no confirmation.
 */

import { useEffect, useMemo, useState } from "preact/hooks";
import type { ExerciseDef } from "~/exercises/types";
import { describeBucket } from "~/scores/bucket";
import { linearSlope } from "~/stats/descriptive";
import { computeIndex } from "~/stats/zscore";
import { isPersonalBest, queryRuns, summariseBucket } from "~/store/runs";
import type { Run } from "~/store/types";

interface Props {
  def: ExerciseDef;
  run: Run;
  onRetry: () => void;
  onHome: () => void;
  onReconfigure: () => void;
}

function formatMetric(value: number | undefined, precision = 0): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(precision);
}

export function Results({ def, run, onRetry, onHome, onReconfigure }: Props) {
  const [history, setHistory] = useState<Run[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void queryRuns({ scoreBucket: run.scoreBucket }).then((runs) => {
      if (!cancelled) setHistory(runs);
    });
    return () => {
      cancelled = true;
    };
  }, [run.scoreBucket, run.id]);

  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === " " || key === "r") {
        event.preventDefault();
        onRetry();
      } else if (key === "escape") {
        onHome();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onRetry, onHome]);

  const analysis = useMemo(() => {
    if (!history) return null;
    // The just-finished run is already in `history` once the write lands, so
    // exclude it by id rather than by count to stay correct either way.
    const previous = history.filter((r) => r.id !== run.id);
    const summary = summariseBucket(history, def.higherIsBetter);
    const scores = [...previous]
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((r) => r.primaryScore);
    return {
      previous,
      summary,
      isPb: run.valid && isPersonalBest(run.primaryScore, previous, def.higherIsBetter),
      index: computeIndex(run.primaryScore, scores, def.higherIsBetter),
      slope: linearSlope(scores.slice(-10)),
    };
  }, [history, run, def]);

  const primaryDef = def.metrics.find((m) => m.key === def.primaryMetric);

  return (
    <div class="app-shell">
      <header class="app-header">
        <h1 class="app-title exercise">{def.name}</h1>
        <span class="faint">{describeBucket(def, run.configSnapshot)}</span>
      </header>

      {!run.valid && (
        <div class="banner is-error">
          この記録は無効です: {run.invalidReason}
          <br />
          <span class="faint">集計と自己ベストには含まれません。</span>
        </div>
      )}

      {run.suspicion.length > 0 && (
        <div class="banner">
          {run.suspicion.map((item) => (
            <div key={item}>{item}</div>
          ))}
        </div>
      )}

      <div class="card">
        <div class="row">
          <div class="metric">
            <span class="metric-label">{primaryDef?.label ?? def.primaryMetric}</span>
            <span class="metric-value is-primary">
              {formatMetric(run.primaryScore, primaryDef?.precision ?? 0)}
              <span class="faint"> {primaryDef?.unit ?? ""}</span>
            </span>
          </div>
          {analysis?.isPb && <span class="pb-badge">NEW PB</span>}
        </div>

        <div class="metric-grid">
          {def.metrics
            .filter((metric) => metric.key !== def.primaryMetric)
            .map((metric) => (
              <div class="metric" key={metric.key}>
                <span class="metric-label">{metric.label}</span>
                <span class="metric-value">
                  {formatMetric(run.metrics[metric.key], metric.precision ?? 0)}
                  <span class="faint"> {metric.unit ?? ""}</span>
                </span>
              </div>
            ))}
        </div>
      </div>

      <div class="card" style="margin-top: var(--s-4)">
        <h2 style="font-size: 1rem; margin-bottom: var(--s-3)">この設定での記録</h2>
        {analysis?.summary ? (
          <div class="metric-grid">
            <div class="metric">
              <span class="metric-label">自己ベスト</span>
              <span class="metric-value">
                {formatMetric(analysis.summary.best, primaryDef?.precision ?? 0)}
              </span>
            </div>
            <div class="metric">
              <span class="metric-label">直近5回平均</span>
              <span class="metric-value">
                {formatMetric(analysis.summary.recentMean, primaryDef?.precision ?? 0)}
              </span>
            </div>
            <div class="metric">
              <span class="metric-label">記録数</span>
              <span class="metric-value">{analysis.summary.count}</span>
            </div>
            <div class="metric">
              <span class="metric-label">指数</span>
              <span class="metric-value">
                {analysis.index.reliable ? analysis.index.index : "測定中"}
              </span>
              {!analysis.index.reliable && (
                <span class="faint">あと {10 - analysis.index.sampleSize} 回</span>
              )}
            </div>
            <div class="metric">
              <span class="metric-label">トレンド</span>
              <span class="metric-value">
                {analysis.previous.length < 3
                  ? "—"
                  : trendArrow(analysis.slope, def.higherIsBetter)}
              </span>
            </div>
          </div>
        ) : (
          <p class="muted">読み込み中…</p>
        )}
      </div>

      <div class="row" style="margin-top: var(--s-5)">
        <button type="button" class="primary" onClick={onRetry}>
          もう一度 <kbd>Space</kbd>
        </button>
        <button type="button" onClick={onReconfigure}>
          設定を変える
        </button>
        <button type="button" onClick={onHome}>
          ホーム <kbd>Esc</kbd>
        </button>
      </div>
    </div>
  );
}

function trendArrow(slope: number, higherIsBetter: boolean): string {
  const directed = higherIsBetter ? slope : -slope;
  if (Math.abs(directed) < 1e-6) return "→";
  return directed > 0 ? "↗ 改善" : "↘ 低下";
}
