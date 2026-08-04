/**
 * Simple / choice reaction time.
 *
 * Two jobs. It is the daily baseline described in PLAN §5.1 — a 30-second read on
 * alertness that tells you whether a bad N-back session means declining ability or
 * just a bad night's sleep. And it is the Phase 0 proving ground: it exercises
 * every piece of the measurement core with nothing else in the way, so if the
 * numbers here are wrong, they would be wrong everywhere.
 */

import { paintAndTimestamp } from "~/core/clock";
import { onKey } from "~/core/input";
import { AbortError, delay } from "~/core/scheduler";
import type { ExerciseDef, RunResult, SessionContext, TrialRecord } from "~/exercises/types";
import { mean, median, quantile, stdDev } from "~/stats/descriptive";

type Mode = "simple" | "choice";

interface RtStimulus {
  /** Which target lit up. Always 0 in simple mode. */
  index: number;
  waitMs: number;
}

export const reactionTimeDef: ExerciseDef = {
  id: "reactiontime",
  name: "反応時間",
  blurb: "その日の覚醒度を測る基準線。訓練ではなく体調チェック用。",
  domains: ["processing-speed"],
  bucketVersion: 1,
  timingSensitive: true,
  higherIsBetter: false,
  primaryMetric: "medianRt",
  settings: [
    {
      key: "mode",
      label: "モード",
      kind: "enum",
      affects: "difficulty",
      options: [
        { value: "simple", label: "単純反応" },
        { value: "choice", label: "選択反応" },
      ],
      default: "simple",
      help: "単純反応は合図が出たら押すだけ。選択反応は光った位置に対応するキーを押す。",
    },
    {
      key: "trials",
      label: "試行数",
      kind: "int",
      affects: "difficulty",
      min: 5,
      max: 100,
      step: 5,
      default: 20,
      tolerance: 0.2,
    },
    {
      key: "minWait",
      label: "最短待ち時間",
      kind: "ms",
      affects: "difficulty",
      min: 500,
      max: 5000,
      step: 100,
      default: 1000,
      unit: "ms",
      help: "合図までの待ち時間の下限。短いほど予測しやすくなる。",
    },
    {
      key: "maxWait",
      label: "最長待ち時間",
      kind: "ms",
      affects: "difficulty",
      min: 1000,
      max: 10000,
      step: 100,
      default: 3000,
      unit: "ms",
      help: "待ち時間はこの範囲でランダム。幅が広いほど予測できず純粋な反応速度を測れる。",
    },
    {
      key: "warmup",
      label: "ウォームアップ試行",
      kind: "int",
      affects: "difficulty",
      min: 0,
      max: 10,
      step: 1,
      default: 3,
      help: "記録に含めない練習試行。JIT と本人の立ち上がりを吸収する。",
    },
    {
      key: "showFeedback",
      label: "毎回の反応時間を表示",
      kind: "bool",
      affects: "cosmetic",
      default: true,
    },
  ],
  metrics: [
    { key: "medianRt", label: "中央値", unit: "ms", precision: 0, higherIsBetter: false },
    { key: "meanRt", label: "平均", unit: "ms", precision: 0, higherIsBetter: false },
    { key: "bestRt", label: "最速", unit: "ms", precision: 0, higherIsBetter: false },
    { key: "sdRt", label: "標準偏差", unit: "ms", precision: 1, higherIsBetter: false },
    { key: "p95Rt", label: "p95", unit: "ms", precision: 0, higherIsBetter: false },
    { key: "lapses", label: "遅延反応", unit: "回", precision: 0, higherIsBetter: false },
    { key: "falseStarts", label: "フライング", unit: "回", precision: 0, higherIsBetter: false },
  ],
  run: runReactionTime,
};

/** Responses slower than this count as attention lapses, a standard PVT cutoff. */
const LAPSE_THRESHOLD_MS = 500;

const CHOICE_KEYS = ["f", "j"] as const;

async function runReactionTime(ctx: SessionContext): Promise<RunResult> {
  const config = ctx.config;
  const mode = config.mode as Mode;
  const trialCount = config.trials as number;
  const warmup = config.warmup as number;
  const minWait = config.minWait as number;
  const maxWait = Math.max(config.maxWait as number, config.minWait as number);
  const showFeedback = config.showFeedback as boolean;

  const view = buildView(ctx.root, mode);
  const trials: TrialRecord[] = [];
  const startedAt = performance.now();
  let falseStarts = 0;

  try {
    view.setMessage(
      mode === "simple" ? "合図が出たら Space" : "光った側の F または J",
      "準備ができたらキーを押して開始",
    );
    await waitForAnyKey(ctx.signal);

    const total = warmup + trialCount;
    for (let i = 0; i < total; i++) {
      const isWarmup = i < warmup;
      const waitMs = ctx.rng.range(minWait, maxWait);
      const index = mode === "choice" ? ctx.rng.int(2) : 0;

      view.reset(
        isWarmup ? `ウォームアップ ${i + 1}/${warmup}` : `${i - warmup + 1}/${trialCount}`,
      );

      // A press during the wait is a guess, not a reaction. Restart the trial so
      // that anticipating never produces a fast time.
      const jumped = await waitForStimulusWindow(waitMs, ctx.signal);
      if (jumped) {
        falseStarts++;
        view.setMessage("早すぎます", "もう一度");
        await delay(900, ctx.signal);
        i--;
        continue;
      }

      const presentedAt = await paintAndTimestamp(() => view.show(index));
      const response = await waitForResponse(mode, index, ctx.signal);
      const rtMs = response.at - presentedAt;

      view.hide();

      if (!isWarmup) {
        trials.push({
          i: trials.length,
          stimulus: { index, waitMs } satisfies RtStimulus,
          isTarget: true,
          response: response.key,
          correct: response.correct,
          rtMs: response.correct ? rtMs : null,
          presentedAt: presentedAt - startedAt,
        });
        ctx.onProgress?.(trials.length / trialCount);
      }

      if (showFeedback) {
        view.setMessage(
          response.correct ? `${Math.round(rtMs)} ms` : "キーが違います",
          isWarmup ? "ウォームアップ（記録されません）" : "",
        );
      }
      await delay(600, ctx.signal);
    }
  } catch (error) {
    if (error instanceof AbortError) {
      return {
        metrics: {},
        primaryScore: Number.NaN,
        trials,
        durationMs: performance.now() - startedAt,
        aborted: true,
      };
    }
    throw error;
  } finally {
    view.dispose();
  }

  return {
    ...scoreReactionTime(trials, falseStarts),
    trials,
    durationMs: performance.now() - startedAt,
  };
}

/**
 * Pure scoring, split out so it can run server-side unchanged (PLAN §9.4b).
 * The median is the primary metric rather than the mean: reaction time
 * distributions have a long right tail, and one lapse would drag a mean by more
 * than a real improvement ever would.
 */
export function scoreReactionTime(
  trials: readonly TrialRecord[],
  falseStarts: number,
): { metrics: Record<string, number>; primaryScore: number } {
  const rts = trials
    .map((t) => t.rtMs)
    .filter((rt): rt is number => rt !== null && Number.isFinite(rt));

  if (rts.length === 0) {
    return {
      metrics: { falseStarts, lapses: 0 },
      primaryScore: Number.NaN,
    };
  }

  const metrics = {
    medianRt: median(rts),
    meanRt: mean(rts),
    bestRt: Math.min(...rts),
    sdRt: stdDev(rts),
    p95Rt: quantile(rts, 0.95),
    lapses: rts.filter((rt) => rt > LAPSE_THRESHOLD_MS).length,
    falseStarts,
    accuracy: rts.length / Math.max(trials.length, 1),
  };

  return { metrics, primaryScore: metrics.medianRt };
}

/** Resolves true if a key was pressed before the wait elapsed (a false start). */
function waitForStimulusWindow(waitMs: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const stopListening = onKey(() => {
      if (settled) return;
      settled = true;
      stopListening();
      resolve(true);
    });

    delay(waitMs, signal)
      .then(() => {
        if (settled) return;
        settled = true;
        stopListening();
        resolve(false);
      })
      .catch((error) => {
        stopListening();
        reject(error);
      });
  });
}

interface RtResponse {
  at: number;
  key: string;
  correct: boolean;
}

function waitForResponse(mode: Mode, index: number, signal: AbortSignal): Promise<RtResponse> {
  const accepted = mode === "choice" ? [...CHOICE_KEYS] : [" ", "spacebar"];
  const expected = mode === "choice" ? CHOICE_KEYS[index] : null;

  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      stopListening();
      reject(new AbortError());
    };
    const stopListening = onKey(
      (response) => {
        stopListening();
        signal.removeEventListener("abort", onAbort);
        resolve({
          at: response.at,
          key: response.key,
          correct: expected === null || response.key === expected,
        });
      },
      { accept: accepted },
    );
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function waitForAnyKey(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      stop();
      reject(new AbortError());
    };
    const stop = onKey(() => {
      stop();
      signal.removeEventListener("abort", onAbort);
      resolve();
    });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

interface RtView {
  show(index: number): void;
  hide(): void;
  reset(counter: string): void;
  setMessage(primary: string, secondary?: string): void;
  dispose(): void;
}

/**
 * Builds the session DOM imperatively rather than through the component tree.
 *
 * The stimulus must appear on the very next frame after we ask for it. Routing
 * that through a re-render adds scheduling we do not control, and the reconciler
 * can coalesce updates in ways that would move the paint by a frame — which is
 * exactly the error we are trying to measure.
 */
function buildView(root: HTMLElement, mode: Mode): RtView {
  root.innerHTML = "";
  const stage = document.createElement("div");
  stage.className = "rt-stage";

  const counter = document.createElement("div");
  counter.className = "rt-counter";

  const targets = document.createElement("div");
  targets.className = "rt-targets";
  const cells = (mode === "choice" ? [0, 1] : [0]).map((i) => {
    const cell = document.createElement("div");
    cell.className = "rt-target";
    if (mode === "choice") cell.dataset.key = CHOICE_KEYS[i]?.toUpperCase();
    targets.append(cell);
    return cell;
  });

  const message = document.createElement("div");
  message.className = "rt-message";
  const hint = document.createElement("div");
  hint.className = "rt-hint";

  stage.append(counter, targets, message, hint);
  root.append(stage);

  return {
    show(index) {
      cells[index]?.classList.add("is-lit");
    },
    hide() {
      for (const cell of cells) cell.classList.remove("is-lit");
    },
    reset(counterText) {
      counter.textContent = counterText;
      message.textContent = "";
      hint.textContent = "";
      for (const cell of cells) cell.classList.remove("is-lit");
    },
    setMessage(primary, secondary = "") {
      message.textContent = primary;
      hint.textContent = secondary;
    },
    dispose() {
      root.innerHTML = "";
    },
  };
}
