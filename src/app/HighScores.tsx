/**
 * High-score screen — PLAN §7.2, view 1.
 *
 * The filter row is generated from the exercise's difficulty settings, so it is
 * the same list that forms the score bucket: whatever separates two records in
 * storage is exactly what can be filtered on here, with nothing to keep in sync
 * by hand.
 *
 * It opens on an exact match of the config last used, because a table that mixes
 * N=2 and N=4 is a table of incomparable numbers. Widening is one click per
 * setting, and widening exactly one turns the ranking into the free-axis view:
 * the personal best at each value of that setting, side by side.
 *
 * Views 2 and 3 from PLAN §7.2 (the pivot heatmap and the cross-exercise bucket
 * list) are phase 2 and not here.
 */

import { useEffect, useMemo, useState } from "preact/hooks";
import { exercises } from "~/exercises/registry";
import type { Config, ExerciseDef } from "~/exercises/types";
import { withDefaults } from "~/exercises/types";
import { describeBucket } from "~/scores/bucket";
import {
  ANY,
  applyFilters,
  defaultFilters,
  deviceOptions,
  type FilterState,
  filterableSettings,
  freeAxis,
  groupByAxis,
  optionsFor,
  type Period,
  rankRuns,
} from "~/scores/highscore";
import { queryRuns } from "~/store/runs";
import { loadConfig } from "~/store/settings";
import type { Run } from "~/store/types";
import { formatDateTime, formatMetric } from "~/ui/format";

/** Rows past this are scrolling, not reading. */
const MAX_ROWS = 50;

const PERIODS: { value: Period; label: string }[] = [
  { value: "all", label: "全期間" },
  { value: "30d", label: "30日" },
  { value: "7d", label: "7日" },
  { value: "today", label: "今日" },
];

interface Props {
  onHome: () => void;
}

export function HighScores({ onHome }: Props) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [def, setDef] = useState<ExerciseDef>(exercises[0] as ExerciseDef);
  const [filters, setFilters] = useState<FilterState | null>(null);

  useEffect(() => {
    void queryRuns({ includeInvalid: true }).then(setRuns);
  }, []);

  // Re-seeded whenever the exercise changes, from that exercise's stored config:
  // "exactly what I last played" is only a useful default if it follows the tab.
  useEffect(() => {
    let cancelled = false;
    void loadConfig(def.id).then((stored) => {
      if (!cancelled) setFilters(defaultFilters(def, withDefaults(def, stored) as Config));
    });
    return () => {
      cancelled = true;
    };
  }, [def]);

  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onHome();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onHome]);

  const forExercise = useMemo(
    () => (runs ?? []).filter((run) => run.exerciseId === def.id),
    [runs, def],
  );

  const matched = useMemo(
    () => (filters ? applyFilters(def, forExercise, filters, Date.now()) : []),
    [def, forExercise, filters],
  );

  const axis = filters ? freeAxis(def, filters) : null;
  const ranked = useMemo(
    () => rankRuns(matched, def.higherIsBetter).slice(0, MAX_ROWS),
    [matched, def],
  );
  const groups = useMemo(
    () => (axis ? groupByAxis(matched, axis, def.higherIsBetter) : []),
    [axis, matched, def],
  );

  const primary = def.metrics.find((metric) => metric.key === def.primaryMetric);
  const precision = primary?.precision ?? 0;

  const setSetting = (key: string, value: string): void =>
    setFilters((current) =>
      current ? { ...current, settings: { ...current.settings, [key]: value } } : current,
    );

  const widenAll = (): void =>
    setFilters((current) => {
      if (!current) return current;
      const settings: Record<string, string> = {};
      for (const setting of filterableSettings(def)) settings[setting.key] = ANY;
      return { ...current, settings, device: ANY };
    });

  return (
    <div class="app-shell">
      <header class="app-header">
        <h1 class="app-title">ハイスコア</h1>
        <button type="button" onClick={onHome}>
          ホーム <kbd>Esc</kbd>
        </button>
      </header>

      <div class="row">
        {exercises.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            class={candidate.id === def.id ? "preset is-active" : "preset"}
            onClick={() => setDef(candidate)}
          >
            {candidate.name}
          </button>
        ))}
      </div>

      {filters && (
        <div class="card" style="margin-top: var(--s-4)">
          <div class="row" style="justify-content: space-between; align-items: baseline">
            <div class="settings-legend" style="margin: 0">
              絞り込み — 「すべて」を1つだけにすると、その項目ごとの自己ベストが並びます
            </div>
            <button type="button" onClick={widenAll}>
              すべて解除
            </button>
          </div>

          <div class="filter-grid">
            {filterableSettings(def).map((setting) => {
              const options = optionsFor(forExercise, setting);
              return (
                <label class="filter" key={setting.key}>
                  <span class="filter-label">{setting.label}</span>
                  <select
                    value={filters.settings[setting.key] ?? ANY}
                    onChange={(event) =>
                      setSetting(setting.key, (event.currentTarget as HTMLSelectElement).value)
                    }
                  >
                    <option value={ANY}>すべて</option>
                    {options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}（{option.count}）
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}

            <label class="filter">
              <span class="filter-label">端末</span>
              <select
                value={filters.device}
                onChange={(event) =>
                  setFilters({
                    ...filters,
                    device: (event.currentTarget as HTMLSelectElement).value,
                  })
                }
              >
                <option value={ANY}>すべて</option>
                {deviceOptions(forExercise).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}（{option.count}）
                  </option>
                ))}
              </select>
            </label>

            <label class="filter">
              <span class="filter-label">期間</span>
              <select
                value={filters.period}
                onChange={(event) =>
                  setFilters({
                    ...filters,
                    period: (event.currentTarget as HTMLSelectElement).value as Period,
                  })
                }
              >
                {PERIODS.map((period) => (
                  <option key={period.value} value={period.value}>
                    {period.label}
                  </option>
                ))}
              </select>
            </label>

            <label class="filter filter-check">
              <input
                type="checkbox"
                checked={filters.includeInvalid}
                onChange={(event) =>
                  setFilters({
                    ...filters,
                    includeInvalid: (event.currentTarget as HTMLInputElement).checked,
                  })
                }
              />
              <span>無効な記録も含める</span>
            </label>
          </div>
        </div>
      )}

      <div class="card" style="margin-top: var(--s-4)">
        {runs === null && <p class="muted">読み込み中…</p>}

        {runs !== null && matched.length === 0 && (
          <p class="muted">
            この条件の記録はまだありません。絞り込みを「すべて」に広げると、近い条件の記録が出ます。
          </p>
        )}

        {/* Free axis: one row per value of the open setting, showing its best.
            This is the N=1..5 ladder PLAN §7.2 describes. */}
        {axis && groups.length > 0 && (
          <>
            <h2 class="section-title">{axis.label}ごとの自己ベスト</h2>
            <div class="scroll-x">
              <table class="score-table">
                <thead>
                  <tr>
                    <th>{axis.label}</th>
                    <th>{primary?.label ?? def.primaryMetric}</th>
                    <th>日付</th>
                    <th>記録数</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <tr key={group.value}>
                      <td class="score-axis">{group.label}</td>
                      <td class="score-value">
                        {formatMetric(group.best.primaryScore, precision)}
                        <span class="faint"> {primary?.unit ?? ""}</span>
                      </td>
                      <td class="faint">{formatDateTime(group.best.startedAt)}</td>
                      <td class="faint">{group.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {!axis && ranked.length > 0 && (
          <>
            <h2 class="section-title">
              ランキング
              <span class="faint">
                {" "}
                {matched.length} 件
                {matched.length > MAX_ROWS ? `（上位 ${MAX_ROWS} 件を表示）` : ""}
              </span>
            </h2>
            <div class="scroll-x">
              <table class="score-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{primary?.label ?? def.primaryMetric}</th>
                    <th>日付</th>
                    <th>条件</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map(({ rank, run }) => (
                    <tr key={run.id} class={run.valid ? "" : "is-invalid"}>
                      <td class="score-rank">{rank}</td>
                      <td class="score-value">
                        {formatMetric(run.primaryScore, precision)}
                        <span class="faint"> {primary?.unit ?? ""}</span>
                        {rank === 1 && run.valid && <span class="pb-badge">PB</span>}
                      </td>
                      <td class="faint">{formatDateTime(run.startedAt)}</td>
                      <td class="faint">
                        {describeBucket(def, run.configSnapshot)}
                        {!run.valid && <span class="score-flag">無効</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
