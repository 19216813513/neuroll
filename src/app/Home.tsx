/**
 * Home screen.
 *
 * Phase 0 scope: exercise tiles with their personal best, plus the export
 * controls. Export lands this early because the realistic way to lose a year of
 * history is the browser clearing site data, and that can happen before any of
 * the analysis screens exist.
 */

import { useEffect, useState } from "preact/hooks";
import type { DeviceProfile } from "~/core/deviceProfile";
import { exercises } from "~/exercises/registry";
import type { ExerciseDef } from "~/exercises/types";
import { downloadFile, exportAll, importBackup, runsToCsv } from "~/store/backup";
import { queryRuns, summariseBucket } from "~/store/runs";
import type { Run } from "~/store/types";

interface Props {
  deviceProfile: DeviceProfile | null;
  onStart: (def: ExerciseDef) => void;
}

export function Home({ deviceProfile, onStart }: Props) {
  const [runsByExercise, setRunsByExercise] = useState<Map<string, Run[]>>(new Map());
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void queryRuns().then((runs) => {
      const grouped = new Map<string, Run[]>();
      for (const run of runs) {
        const list = grouped.get(run.exerciseId) ?? [];
        list.push(run);
        grouped.set(run.exerciseId, list);
      }
      setRunsByExercise(grouped);
    });
  }, []);

  const handleExport = async (format: "json" | "csv"): Promise<void> => {
    const backup = await exportAll(__APP_VERSION__);
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === "json") {
      downloadFile(`neuroll-${stamp}.json`, JSON.stringify(backup), "application/json");
    } else {
      downloadFile(`neuroll-runs-${stamp}.csv`, runsToCsv(backup.runs), "text/csv");
    }
    setMessage(`${backup.runs.length} 件の記録をエクスポートしました`);
  };

  const handleImport = (event: Event): void => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    void file
      .text()
      .then((text) => importBackup(JSON.parse(text)))
      .then((result) => {
        setMessage(
          `${result.runsAdded} 件を取り込みました（重複 ${result.runsSkipped} 件はスキップ）`,
        );
        return queryRuns();
      })
      .then((runs) => {
        const grouped = new Map<string, Run[]>();
        for (const run of runs) {
          const list = grouped.get(run.exerciseId) ?? [];
          list.push(run);
          grouped.set(run.exerciseId, list);
        }
        setRunsByExercise(grouped);
      })
      .catch((error: Error) => setMessage(`取り込みに失敗: ${error.message}`))
      .finally(() => {
        input.value = "";
      });
  };

  return (
    <div class="app-shell">
      <header class="app-header">
        <h1 class="app-title">neuroll</h1>
        <span class="faint">
          {deviceProfile
            ? `${deviceProfile.refreshRateHz}Hz / ${deviceProfile.deviceClass}`
            : "環境を計測中…"}
        </span>
      </header>

      {message && <div class="banner">{message}</div>}

      <div class="tile-grid">
        {exercises.map((def) => {
          const runs = runsByExercise.get(def.id) ?? [];
          const primary = def.metrics.find((m) => m.key === def.primaryMetric);
          // Group by bucket so the tile shows the best of the config actually
          // being trained, not a best mixed across incomparable settings.
          const byBucket = new Map<string, Run[]>();
          for (const run of runs) {
            const list = byBucket.get(run.scoreBucket) ?? [];
            list.push(run);
            byBucket.set(run.scoreBucket, list);
          }
          const summaries = [...byBucket.values()]
            .map((list) => summariseBucket(list, def.higherIsBetter))
            .filter((s) => s !== null);
          const mostRecent = summaries.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)[0];

          return (
            <div class="tile" key={def.id}>
              <span class="tile-name">{def.name}</span>
              <span class="faint">{def.blurb}</span>
              <span class="tile-stat">
                {mostRecent ? `${mostRecent.best.toFixed(primary?.precision ?? 0)}` : "—"}
                <span class="faint" style="font-size: 0.85rem">
                  {" "}
                  {mostRecent ? (primary?.unit ?? "") : "未記録"}
                </span>
              </span>
              {mostRecent && (
                <span class="faint">
                  直近5回 {mostRecent.recentMean.toFixed(primary?.precision ?? 0)} ・{" "}
                  {mostRecent.count} 回
                </span>
              )}
              <button
                type="button"
                class="primary"
                style="margin-top: var(--s-2)"
                onClick={() => onStart(def)}
                disabled={!deviceProfile}
              >
                開始
              </button>
            </div>
          );
        })}
      </div>

      <div class="card" style="margin-top: var(--s-6)">
        <h2 style="font-size: 1rem; margin-bottom: var(--s-3)">データ</h2>
        <p class="faint" style="margin-top: 0">
          記録はこの端末のブラウザ内にのみ保存されます。サイトデータを削除すると失われるため、
          定期的にエクスポートしてください。
        </p>
        <div class="row">
          <button type="button" onClick={() => void handleExport("json")}>
            JSON エクスポート
          </button>
          <button type="button" onClick={() => void handleExport("csv")}>
            CSV エクスポート
          </button>
          <label class="row" style="gap: var(--s-2)">
            <span
              class="faint"
              style="border: 1px solid var(--border-strong); border-radius: var(--radius); padding: var(--s-2) var(--s-4); cursor: pointer"
            >
              インポート
            </span>
            <input type="file" accept="application/json" onChange={handleImport} hidden />
          </label>
        </div>
      </div>
    </div>
  );
}
