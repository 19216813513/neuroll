/**
 * Schulte table (数字探し).
 *
 * A grid of shuffled symbols is tapped in order as fast as possible. Trains
 * visual search speed and, in the fixation-guided modes, the ability to pick
 * targets out of peripheral vision instead of scanning serially.
 *
 * Unlike the reaction-time exercise, the score here is dominated by search time
 * rather than input latency, so `timingSensitive` is false and records made with
 * a mouse and a touchscreen share a bucket.
 */

import { paintAndTimestamp } from "~/core/clock";
import { eventTime } from "~/core/input";
import { AbortError } from "~/core/scheduler";
import type { ExerciseDef, RunResult, SessionContext, TrialRecord } from "~/exercises/types";
import { mean, stdDev } from "~/stats/descriptive";

type Order = "asc" | "desc" | "alternating";
type SymbolSet = "digits" | "hiragana" | "latin";

const HIRAGANA = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめも".split("");
const LATIN = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export const schulteDef: ExerciseDef = {
  id: "schulte",
  name: "数字探し",
  blurb: "格子状の数字を順にタップ。視覚探索と周辺視を鍛える。",
  domains: ["processing-speed", "visuospatial"],
  bucketVersion: 1,
  timingSensitive: false,
  higherIsBetter: false,
  primaryMetric: "totalMs",
  settings: [
    {
      key: "size",
      label: "グリッド",
      kind: "int",
      affects: "difficulty",
      min: 3,
      max: 9,
      step: 1,
      default: 5,
      help: "5×5 が標準。1 増えるだけで探索範囲が大きく広がる。",
    },
    {
      key: "order",
      label: "順序",
      kind: "enum",
      affects: "difficulty",
      options: [
        { value: "asc", label: "昇順" },
        { value: "desc", label: "降順" },
        { value: "alternating", label: "交互（1,25,2,24…）" },
      ],
      default: "asc",
      help: "交互は両端から追うためワーキングメモリ負荷が加わり、難度が跳ね上がる。",
    },
    {
      key: "symbols",
      label: "記号",
      kind: "enum",
      affects: "difficulty",
      options: [
        { value: "digits", label: "数字" },
        { value: "hiragana", label: "ひらがな" },
        { value: "latin", label: "アルファベット" },
      ],
      default: "digits",
    },
    {
      key: "penaltyMs",
      label: "誤タップのペナルティ",
      kind: "ms",
      affects: "difficulty",
      min: 0,
      max: 3000,
      step: 100,
      default: 500,
      unit: "ms",
      help: "0 にすると誤タップし放題になり、当てずっぽうが速くなってしまう。",
    },
    {
      key: "reshuffle",
      label: "1手ごとに再配置",
      kind: "bool",
      affects: "difficulty",
      default: false,
      advanced: true,
      help: "毎回配置が変わるため位置の記憶が使えなくなる。超高難度。",
    },
    {
      key: "showNext",
      label: "次のターゲットを表示",
      kind: "bool",
      affects: "cosmetic",
      default: true,
    },
    {
      key: "cellSize",
      label: "セルサイズ",
      kind: "int",
      affects: "cosmetic",
      min: 40,
      max: 120,
      step: 4,
      default: 68,
      unit: "px",
    },
  ],
  metrics: [
    { key: "totalMs", label: "総時間", unit: "ms", precision: 0, higherIsBetter: false },
    { key: "perItemMs", label: "1手あたり", unit: "ms", precision: 0, higherIsBetter: false },
    { key: "sdPerItemMs", label: "安定性(SD)", unit: "ms", precision: 0, higherIsBetter: false },
    { key: "errors", label: "誤タップ", unit: "回", precision: 0, higherIsBetter: false },
  ],
  run: runSchulte,
};

/** The sequence of cell values to hit, in the order they must be hit. */
export function targetOrder(count: number, order: Order): number[] {
  const ascending = Array.from({ length: count }, (_, i) => i + 1);
  if (order === "asc") return ascending;
  if (order === "desc") return ascending.slice().reverse();

  // Alternating walks inward from both ends: 1, n, 2, n-1, ...
  const result: number[] = [];
  let low = 0;
  let high = count - 1;
  while (low <= high) {
    result.push(ascending[low] as number);
    if (low !== high) result.push(ascending[high] as number);
    low++;
    high--;
  }
  return result;
}

export function symbolFor(value: number, set: SymbolSet): string {
  if (set === "hiragana") return HIRAGANA[(value - 1) % HIRAGANA.length] as string;
  if (set === "latin") return LATIN[(value - 1) % LATIN.length] as string;
  return String(value);
}

/**
 * Pure scoring. Splitting this out keeps it runnable server-side and makes the
 * statistics testable without a DOM.
 */
export function scoreSchulte(
  intervals: readonly number[],
  errors: number,
  penaltyMs: number,
): { metrics: Record<string, number>; primaryScore: number } {
  const rawTotal = intervals.reduce((sum, v) => sum + v, 0);
  // Penalties are added to the reported total so that guessing cannot buy speed.
  const totalMs = rawTotal + errors * penaltyMs;

  const metrics = {
    totalMs,
    rawTotalMs: rawTotal,
    perItemMs: intervals.length > 0 ? mean(intervals) : Number.NaN,
    // A low SD means an even scan; a high one means some targets were hunted for.
    sdPerItemMs: intervals.length > 1 ? stdDev(intervals) : Number.NaN,
    errors,
    items: intervals.length,
  };
  return { metrics, primaryScore: totalMs };
}

async function runSchulte(ctx: SessionContext): Promise<RunResult> {
  const config = ctx.config;
  const size = config.size as number;
  const order = config.order as Order;
  const symbols = config.symbols as SymbolSet;
  const penaltyMs = config.penaltyMs as number;
  const reshuffle = config.reshuffle as boolean;
  const showNext = config.showNext as boolean;
  const cellSize = config.cellSize as number;

  const cellCount = size * size;
  const sequence = targetOrder(cellCount, order);

  const view = buildView(ctx.root, { size, cellSize, symbols, showNext });
  const records: TrialRecord[] = [];
  const intervals: number[] = [];
  const startedAt = performance.now();
  let errors = 0;

  try {
    view.setMessage("クリックで開始", "1 から順にできるだけ速く");
    await view.waitForStart(ctx.signal);

    let layout = ctx.rng.shuffle(Array.from({ length: cellCount }, (_, i) => i + 1));
    let previousAt = await paintAndTimestamp(() => {
      view.render(layout);
      view.setNext(sequence[0] as number);
      view.clearMessage();
    });

    for (let step = 0; step < sequence.length; step++) {
      const wanted = sequence[step] as number;
      view.setNext(wanted);

      // Wrong taps do not advance; they cost time and are counted. This is what
      // stops "click everything quickly" from being a viable strategy.
      let hit = await view.waitForTap(ctx.signal);
      while (hit.value !== wanted) {
        errors++;
        view.flashWrong(hit.index);
        records.push({
          i: records.length,
          stimulus: { wanted, step },
          isTarget: false,
          response: hit.value,
          correct: false,
          rtMs: hit.at - previousAt,
          presentedAt: previousAt - startedAt,
        });
        hit = await view.waitForTap(ctx.signal);
      }

      const interval = hit.at - previousAt;
      intervals.push(interval);
      previousAt = hit.at;

      records.push({
        i: records.length,
        stimulus: { wanted, step },
        isTarget: true,
        response: hit.value,
        correct: true,
        rtMs: interval,
        presentedAt: previousAt - startedAt,
      });
      ctx.onProgress?.((step + 1) / sequence.length);

      view.markDone(hit.index);

      if (reshuffle && step < sequence.length - 1) {
        layout = ctx.rng.shuffle(layout);
        // Re-time from the repaint: the participant cannot search a grid that is
        // not on screen yet, so the redraw must not be charged to them.
        previousAt = await paintAndTimestamp(() => view.render(layout));
      }
    }
  } catch (error) {
    if (error instanceof AbortError) {
      return {
        metrics: {},
        primaryScore: Number.NaN,
        trials: records,
        durationMs: performance.now() - startedAt,
        aborted: true,
      };
    }
    throw error;
  } finally {
    view.dispose();
  }

  return {
    ...scoreSchulte(intervals, errors, penaltyMs),
    trials: records,
    durationMs: performance.now() - startedAt,
  };
}

interface ViewOptions {
  size: number;
  cellSize: number;
  symbols: SymbolSet;
  showNext: boolean;
}

interface Tap {
  value: number;
  index: number;
  at: number;
}

interface SchulteView {
  render(layout: readonly number[]): void;
  setNext(value: number): void;
  markDone(index: number): void;
  flashWrong(index: number): void;
  waitForTap(signal: AbortSignal): Promise<Tap>;
  waitForStart(signal: AbortSignal): Promise<void>;
  setMessage(title: string, hint: string): void;
  clearMessage(): void;
  dispose(): void;
}

function buildView(root: HTMLElement, options: ViewOptions): SchulteView {
  root.innerHTML = "";
  const stage = document.createElement("div");
  stage.className = "sc-stage";

  const next = document.createElement("div");
  next.className = "sc-next";
  if (!options.showNext) next.style.visibility = "hidden";

  const grid = document.createElement("div");
  grid.className = "sc-grid";
  grid.style.setProperty("--sc-size", String(options.size));
  grid.style.setProperty("--sc-cell", `${options.cellSize}px`);

  const cells: HTMLButtonElement[] = [];
  for (let i = 0; i < options.size * options.size; i++) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "sc-cell";
    cell.dataset.index = String(i);
    grid.append(cell);
    cells.push(cell);
  }

  const message = document.createElement("div");
  message.className = "sc-message";

  stage.append(next, grid, message);
  root.append(stage);

  let values: number[] = [];
  let tapHandler: ((tap: Tap) => void) | null = null;

  // A single delegated listener rather than one per cell: with reshuffle on, a
  // 9x9 grid would otherwise rebind 81 listeners after every tap.
  const onPointerDown = (event: PointerEvent): void => {
    const target = (event.target as HTMLElement).closest(".sc-cell") as HTMLElement | null;
    if (!target || !tapHandler) return;
    const index = Number(target.dataset.index);
    const value = values[index];
    if (value === undefined) return;
    event.preventDefault();
    tapHandler({ value, index, at: eventTime(event) });
  };
  grid.addEventListener("pointerdown", onPointerDown);

  return {
    render(layout) {
      values = [...layout];
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i] as HTMLButtonElement;
        cell.textContent = symbolFor(values[i] as number, options.symbols);
        cell.classList.remove("is-done", "is-wrong");
      }
    },
    setNext(value) {
      next.textContent = symbolFor(value, options.symbols);
    },
    markDone(index) {
      cells[index]?.classList.add("is-done");
    },
    flashWrong(index) {
      const cell = cells[index];
      if (!cell) return;
      cell.classList.add("is-wrong");
      setTimeout(() => cell.classList.remove("is-wrong"), 200);
    },
    waitForTap(signal) {
      return new Promise<Tap>((resolve, reject) => {
        if (signal.aborted) {
          reject(new AbortError());
          return;
        }
        const onAbort = (): void => {
          tapHandler = null;
          reject(new AbortError());
        };
        tapHandler = (tap) => {
          tapHandler = null;
          signal.removeEventListener("abort", onAbort);
          resolve(tap);
        };
        signal.addEventListener("abort", onAbort, { once: true });
      });
    },
    waitForStart(signal) {
      return new Promise<void>((resolve, reject) => {
        const cleanup = (): void => {
          stage.removeEventListener("pointerdown", onStart);
          signal.removeEventListener("abort", onAbort);
        };
        const onStart = (): void => {
          cleanup();
          resolve();
        };
        const onAbort = (): void => {
          cleanup();
          reject(new AbortError());
        };
        stage.addEventListener("pointerdown", onStart, { once: true });
        signal.addEventListener("abort", onAbort, { once: true });
      });
    },
    setMessage(title, hint) {
      message.innerHTML = "";
      const t = document.createElement("div");
      t.className = "sc-title";
      t.textContent = title;
      const h = document.createElement("div");
      h.className = "sc-hint";
      h.textContent = hint;
      message.append(t, h);
    },
    clearMessage() {
      message.innerHTML = "";
    },
    dispose() {
      grid.removeEventListener("pointerdown", onPointerDown);
      root.innerHTML = "";
    },
  };
}
