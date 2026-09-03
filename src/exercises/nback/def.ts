/**
 * N-back.
 *
 * The centrepiece exercise: the strongest available load on working-memory
 * updating. A stimulus stream is presented one item at a time and the
 * participant reports, for each item, whether it matches the one n steps back.
 *
 * Keeping the reconciler out of the stimulus path (see Session.tsx) matters more
 * here than anywhere else, because presentation timing is the independent
 * variable of the whole task.
 */

import { AUDIO_ALPHABET_SIZE, audioEngine } from "~/core/audio";
import { paintAndTimestamp } from "~/core/clock";
import { eventTime } from "~/core/input";
import { AbortError, delay } from "~/core/scheduler";
import type {
  Config,
  ExerciseDef,
  RunResult,
  SessionContext,
  TrialRecord,
} from "~/exercises/types";
import { generateSequence, type Modality, type StreamSpec } from "./generate";
import { type NbackScoreTrial, scoreNback } from "./score";

const MODALITY_KEYS: Record<Modality, string> = {
  position: "a",
  audio: "l",
  color: "s",
  shape: "k",
};

const MODALITY_LABELS: Record<Modality, string> = {
  position: "位置",
  audio: "音",
  color: "色",
  shape: "形",
};

/** Reads the modality list off a config, ignoring anything unrecognised. */
function asModalities(config: Config): Modality[] {
  const raw = config.modalities;
  return (Array.isArray(raw) ? raw : []).filter(
    (m): m is Modality => (m as string) in MODALITY_KEYS,
  );
}

const COLORS = ["#4da3ff", "#f87171", "#4ade80", "#fbbf24", "#c084fc", "#22d3ee"];
const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * The shape alphabet, drawn rather than typed.
 *
 * Font glyphs were the first version of this and the wrong one: which of
 * ●■▲◆★✚ a device actually has, how heavily it draws them, and whether it
 * substitutes a colour emoji all vary by platform — and n-back is not
 * device-partitioned (`timingSensitive` is false, see computeBucket), so two
 * runs in the same bucket could have been looking at different stimuli. A path
 * in a fixed viewBox is identical everywhere and scales with the cell instead
 * of with the font size.
 *
 * Chosen for distinctness at a glance rather than for variety: nothing here is
 * another entry mirrored or rotated (▼ against ▲ would be), because telling
 * those apart is perceptual work and not the memory load the exercise exists to
 * impose. The original six keep their index, so an old sequence still means
 * what it did.
 */
const SHAPES: readonly string[] = [
  // circle
  "M6 50A44 44 0 1 1 94 50A44 44 0 1 1 6 50Z",
  // square
  "M10 10H90V90H10Z",
  // triangle
  "M50 8L94 88H6Z",
  // diamond
  "M50 4L96 50L50 96L4 50Z",
  // star
  "M50 4L61.2 34.6L93.8 35.8L68.1 55.9L77 87.2L50 69L23 87.2L31.9 55.9L6.2 35.8L38.8 34.6Z",
  // plus
  "M35 6H65V35H94V65H65V94H35V65H6V35H35Z",
  // ring — the inner circle is wound the other way, so the hole stays a hole
  "M6 50A44 44 0 1 1 94 50A44 44 0 1 1 6 50ZM26 50A24 24 0 1 0 74 50A24 24 0 1 0 26 50Z",
  // half circle
  "M6 72A44 44 0 0 1 94 72Z",
  // hexagon
  "M96 50L73 89.8L27 89.8L4 50L27 10.2L73 10.2Z",
  // heart
  "M50 92C22 71 8 53 8 36A24 24 0 0 1 50 21A24 24 0 0 1 92 36C92 53 78 71 50 92Z",
];

export const nbackDef: ExerciseDef = {
  id: "nback",
  name: "N-back",
  blurb: "n個前と同じかを判断し続ける。ワーキングメモリの更新に最も強い負荷。",
  instructions: [
    "刺激が1つずつ順番に提示されます。",
    "「今の刺激は N 個前と同じか？」を毎回判断します。N=2 なら 2 個前との比較です（直前ではありません）。",
    "同じだと思ったときだけキーを押します。違うと思ったら何も押しません（押さないのが正解の回も多いです）。",
    "キーはモダリティごとに別です（位置 = A、音/文字 = L、色 = S、形 = K）。複数一致したらその分だけ押します。",
    "最初の N 回は比較対象がないため採点されません。覚えるだけで OK です。",
    "Esc で中断できます。",
  ],
  presets: [
    {
      name: "入門",
      note: "位置のみ / N=1",
      config: { modalities: ["position"], n: 1, trials: 15, isiMs: 2500 },
    },
    {
      name: "シングル",
      note: "位置のみ / N=2",
      config: { modalities: ["position"], n: 2, trials: 20, isiMs: 2500 },
    },
    {
      name: "デュアル標準",
      note: "位置+音 / N=2",
      config: { modalities: ["position", "audio"], n: 2, trials: 20, isiMs: 2500 },
    },
    {
      name: "高負荷",
      note: "N=3 / Lure 20% / 短い間隔",
      config: { modalities: ["position", "audio"], n: 3, trials: 30, isiMs: 1800, lureRate: 20 },
    },
  ],
  domains: ["working-memory"],
  bucketVersion: 1,
  timingSensitive: false,
  higherIsBetter: true,
  primaryMetric: "dPrime",
  settings: [
    {
      key: "modalities",
      label: "モダリティ",
      kind: "multi",
      affects: "difficulty",
      options: [
        { value: "position", label: "位置" },
        { value: "audio", label: "音" },
        { value: "color", label: "色" },
        { value: "shape", label: "形" },
      ],
      default: ["position"],
      help: "2つ以上選ぶとデュアル/トリプル N-back。同時に追う数だけ難度が上がる。",
      // Single visual n-back is the default: it is the version you can learn the
      // rule on, and it works with the sound off.
    },
    {
      key: "n",
      label: "N",
      kind: "int",
      affects: "difficulty",
      min: 1,
      max: 9,
      step: 1,
      default: 2,
      help: "何個前と比較するか。",
    },
    {
      key: "trials",
      label: "試行数",
      kind: "int",
      affects: "difficulty",
      min: 10,
      max: 100,
      step: 5,
      default: 20,
      tolerance: 0.2,
      help: "採点対象の試行数。実際にはこれに N 回分が加算される。",
    },
    {
      key: "stimulusMs",
      label: "刺激提示時間",
      kind: "ms",
      affects: "difficulty",
      min: 200,
      max: 3000,
      step: 50,
      default: 500,
      unit: "ms",
      tolerance: 0.1,
    },
    {
      key: "isiMs",
      label: "刺激間間隔",
      kind: "ms",
      affects: "difficulty",
      min: 300,
      max: 5000,
      step: 50,
      default: 2000,
      unit: "ms",
      tolerance: 0.1,
      help: "短いほど難しい。2500ms 前後が標準。",
    },
    {
      key: "targetRate",
      label: "ターゲット率",
      kind: "int",
      affects: "difficulty",
      min: 10,
      max: 50,
      step: 5,
      default: 25,
      unit: "%",
    },
    {
      key: "lureRate",
      label: "Lure率",
      kind: "int",
      affects: "difficulty",
      min: 0,
      max: 40,
      step: 5,
      default: 0,
      unit: "%",
      advanced: true,
      help: "n±1個前と一致する引っかけ。見覚えだけでは答えられなくなり、体感難度が大きく上がる。",
    },
    {
      key: "gridSize",
      label: "グリッド",
      kind: "enum",
      affects: "difficulty",
      options: [
        { value: "2", label: "2×2" },
        { value: "3", label: "3×3" },
        { value: "4", label: "4×4" },
      ],
      default: "3",
      help: "マスが少ないほど難しい。4マスだと同じ位置がすぐに再来するため、見覚えでは答えられず、何個前だったかを数えるしかなくなる。",
      // Inert without a positional stream: the grid is still drawn, but the
      // stimulus no longer moves around it (see buildView).
      visibleWhen: (config) => asModalities(config).includes("position"),
    },
    {
      key: "feedback",
      label: "フィードバック",
      kind: "enum",
      affects: "cosmetic",
      options: [
        { value: "immediate", label: "即時" },
        { value: "none", label: "なし" },
      ],
      default: "immediate",
    },
    {
      key: "showFixation",
      label: "中央固視点",
      kind: "bool",
      affects: "cosmetic",
      default: true,
    },
    {
      key: "audioMode",
      label: "音の出し方",
      kind: "enum",
      affects: "cosmetic",
      options: [
        { value: "sound", label: "音のみ" },
        { value: "visual", label: "文字のみ" },
        { value: "both", label: "音＋文字" },
      ],
      default: "both",
      help: "音を出せない環境でも、文字表示にすれば同じ課題として成立します。",
      // Without the audio stream there is nothing for this to control, and
      // leaving it adjustable reads as a promise that sound will play.
      visibleWhen: (config) => asModalities(config).includes("audio"),
    },
    {
      key: "volume",
      label: "音量",
      kind: "int",
      affects: "cosmetic",
      min: 0,
      max: 100,
      step: 5,
      default: 70,
      visibleWhen: (config) =>
        asModalities(config).includes("audio") && config.audioMode !== "visual",
    },
  ],
  keyHints: (config) =>
    asModalities(config).map((modality) => ({
      key: MODALITY_KEYS[modality].toUpperCase(),
      label:
        modality === "audio" && config.audioMode !== "sound"
          ? "音/文字"
          : MODALITY_LABELS[modality],
    })),
  metrics: [
    { key: "dPrime", label: "d′", precision: 2, higherIsBetter: true },
    { key: "meanRt", label: "平均反応", unit: "ms", precision: 0, higherIsBetter: false },
    { key: "lureFaRate", label: "Lure誤答率", precision: 2, higherIsBetter: false },
    { key: "trials", label: "採点試行", precision: 0, higherIsBetter: true },
  ],
  run: runNback,
};

function alphabetFor(modality: Modality, gridSize: number): number {
  switch (modality) {
    case "position":
      return gridSize * gridSize;
    case "audio":
      return AUDIO_ALPHABET_SIZE;
    case "color":
      return COLORS.length;
    case "shape":
      return SHAPES.length;
  }
}

async function runNback(ctx: SessionContext): Promise<RunResult> {
  const config = ctx.config;
  const modalities = (config.modalities as string[]).filter(
    (m): m is Modality => m in MODALITY_KEYS,
  );
  if (modalities.length === 0) throw new Error("モダリティを1つ以上選んでください");

  const n = config.n as number;
  const scoredTrials = config.trials as number;
  const gridSize = Number(config.gridSize as string);
  const stimulusMs = config.stimulusMs as number;
  const isiMs = config.isiMs as number;
  const immediateFeedback = (config.feedback as string) === "immediate";

  const streams: StreamSpec[] = modalities.map((modality) => ({
    modality,
    alphabetSize: alphabetFor(modality, gridSize),
  }));

  // The first n trials cannot be targets, so they are presented but not scored.
  // Generating trials + n keeps the scored count equal to what the user asked for.
  const sequence = generateSequence(
    {
      n,
      trials: scoredTrials + n,
      targetRate: (config.targetRate as number) / 100,
      lureRate: (config.lureRate as number) / 100,
      streams,
    },
    ctx.rng,
  );

  const hasAudioStream = modalities.includes("audio");
  const audioMode = (config.audioMode as string) ?? "both";
  const playsSound = hasAudioStream && audioMode !== "visual";
  const showsAudioGlyph = hasAudioStream && audioMode !== "sound";

  if (playsSound) {
    audioEngine.setVolume((config.volume as number) / 100);
    // Failing to get an AudioContext must not kill the session: fall back to the
    // on-screen glyph rather than leaving the participant with no second stream.
    try {
      await audioEngine.init();
    } catch {
      console.warn("neuroll: audio unavailable, falling back to the visual glyph");
    }
  }

  const view = buildView(ctx.root, {
    // With no positional stream there is nothing to place, so the grid collapses
    // to a single centred cell rather than lighting the top-left corner.
    gridSize: modalities.includes("position") ? gridSize : 1,
    modalities,
    showFixation: config.showFixation as boolean,
    showAudioGlyph: showsAudioGlyph || (hasAudioStream && !audioEngine.ready),
    n,
  });

  const records: TrialRecord[] = [];
  const scoreTrials: NbackScoreTrial[] = [];
  const startedAt = performance.now();

  // Pressed state per modality for the current trial. Reused across trials
  // rather than reallocated, so the loop does not allocate while timing.
  const pressed: Record<string, boolean> = {};
  const pressedAt: Record<string, number> = {};
  let presentedAt = 0;

  const keyToModality = new Map<string, Modality>();
  for (const modality of modalities) keyToModality.set(MODALITY_KEYS[modality], modality);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    const modality = keyToModality.get(event.key.toLowerCase());
    if (!modality) return;
    event.preventDefault();
    // Only the first press per trial counts; the rest are the same decision.
    if (pressed[modality]) return;
    pressed[modality] = true;
    pressedAt[modality] = eventTime(event) - presentedAt;
    view.markPressed(modality);
  };

  window.addEventListener("keydown", onKeyDown, { capture: true });

  try {
    view.setMessage(
      `${n}-back`,
      modalities.map((m) => `${MODALITY_LABELS[m]} = ${MODALITY_KEYS[m].toUpperCase()}`).join("　"),
      "キーを押して開始",
    );
    await waitForAnyKey(ctx.signal);
    view.clearMessage();
    await delay(800, ctx.signal);

    for (let i = 0; i < sequence.length; i++) {
      const trial = sequence[i] as (typeof sequence)[number];
      const isScored = i >= n;

      for (const modality of modalities) {
        pressed[modality] = false;
        pressedAt[modality] = Number.NaN;
      }
      view.resetTrial(isScored ? `${i - n + 1}/${scoredTrials}` : "");

      presentedAt = await paintAndTimestamp(() => view.showStimulus(trial.values));
      if (playsSound && audioEngine.ready && trial.values.audio !== undefined) {
        audioEngine.play(trial.values.audio);
      }

      await delay(stimulusMs, ctx.signal);
      view.hideStimulus();

      // Responses stay open through the blank interval: forcing a decision while
      // the stimulus is still visible would measure reading speed, not recall.
      await delay(isiMs, ctx.signal);

      const responded: Record<string, boolean> = {};
      const rtMs: Record<string, number | null> = {};
      let correctAll = true;
      for (const modality of modalities) {
        responded[modality] = pressed[modality] === true;
        rtMs[modality] = pressed[modality] ? (pressedAt[modality] as number) : null;
        if (isScored && responded[modality] !== (trial.isTarget[modality] === true)) {
          correctAll = false;
        }
      }

      scoreTrials.push({
        isTarget: trial.isTarget,
        isLure: trial.isLure,
        response: { responded, rtMs },
        scored: isScored,
      });

      if (isScored) {
        records.push({
          i: records.length,
          stimulus: trial.values,
          isTarget: modalities.some((m) => trial.isTarget[m] === true),
          response: responded,
          correct: correctAll,
          rtMs: firstFiniteRt(rtMs, modalities),
          presentedAt: presentedAt - startedAt,
        });
        ctx.onProgress?.(records.length / scoredTrials);
      }

      if (immediateFeedback && isScored) {
        view.flashFeedback(correctAll);
        await delay(150, ctx.signal);
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
    window.removeEventListener("keydown", onKeyDown, { capture: true });
    view.dispose();
  }

  const scored = scoreNback(scoreTrials, modalities);
  return {
    metrics: scored.metrics,
    primaryScore: scored.primaryScore,
    trials: records,
    durationMs: performance.now() - startedAt,
  };
}

function firstFiniteRt(
  rtMs: Record<string, number | null>,
  modalities: readonly string[],
): number | null {
  for (const modality of modalities) {
    const value = rtMs[modality];
    if (value !== null && value !== undefined && Number.isFinite(value)) return value;
  }
  return null;
}

function waitForAnyKey(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      window.removeEventListener("keydown", handler, { capture: true });
      signal.removeEventListener("abort", onAbort);
    };
    const handler = (event: KeyboardEvent): void => {
      if (event.key === "Escape") return;
      event.preventDefault();
      cleanup();
      resolve();
    };
    const onAbort = (): void => {
      cleanup();
      reject(new AbortError());
    };
    window.addEventListener("keydown", handler, { capture: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Glyphs standing in for the auditory stream when sound is off or unavailable.
 * Deliberately not letters-as-sounds: these are read, so they only need to be
 * mutually distinct at a glance.
 */
const AUDIO_GLYPHS = ["ア", "カ", "サ", "タ", "ナ", "ハ", "マ", "ラ"];

interface ViewOptions {
  gridSize: number;
  modalities: Modality[];
  showFixation: boolean;
  showAudioGlyph: boolean;
  n: number;
}

interface NbackView {
  showStimulus(values: Record<string, number>): void;
  hideStimulus(): void;
  resetTrial(counter: string): void;
  markPressed(modality: Modality): void;
  flashFeedback(correct: boolean): void;
  setMessage(title: string, keys: string, hint: string): void;
  clearMessage(): void;
  dispose(): void;
}

function buildView(root: HTMLElement, options: ViewOptions): NbackView {
  root.innerHTML = "";
  const stage = document.createElement("div");
  stage.className = "nb-stage";

  const counter = document.createElement("div");
  counter.className = "nb-counter";

  const grid = document.createElement("div");
  grid.className = "nb-grid";
  grid.style.setProperty("--grid-size", String(options.gridSize));

  const cells: HTMLDivElement[] = [];
  const shapes: SVGPathElement[] = [];
  for (let i = 0; i < options.gridSize * options.gridSize; i++) {
    const cell = document.createElement("div");
    cell.className = "nb-cell";
    // The shape layer is created up front and left empty. Its box never changes
    // size, so presenting a shape is a repaint and not a relayout — the same
    // reason the cell only ever animates its background colour.
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("class", "nb-shape");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    svg.append(path);
    cell.append(svg);
    grid.append(cell);
    cells.push(cell);
    shapes.push(path);
  }

  // A collapsed grid puts the stimulus exactly where the eye already is, so a
  // fixation mark there would only sit on top of it every single trial.
  if (options.showFixation && options.gridSize > 1) {
    const fixation = document.createElement("div");
    fixation.className = "nb-fixation";
    fixation.textContent = "+";
    grid.append(fixation);
  }

  // Sits below the grid, outside the fixation area, so reading it does not
  // compete with the positional stream for foveal attention.
  const glyph = document.createElement("div");
  glyph.className = "nb-glyph";
  if (!options.showAudioGlyph) glyph.style.display = "none";

  const keys = document.createElement("div");
  keys.className = "nb-keys";
  const keyEls = new Map<Modality, HTMLDivElement>();
  for (const modality of options.modalities) {
    const key = document.createElement("div");
    key.className = "nb-key";
    const label =
      modality === "audio" && options.showAudioGlyph ? "音/文字" : MODALITY_LABELS[modality];
    // "位置 A" alone never says what A does. The rule is the hard part of this
    // task, so the reminder stays on screen for the whole session.
    key.innerHTML = "";
    const kbd = document.createElement("kbd");
    kbd.textContent = MODALITY_KEYS[modality].toUpperCase();
    const text = document.createElement("span");
    text.textContent = `${label}が${options.n}個前と同じ`;
    key.append(kbd, text);
    keys.append(key);
    keyEls.set(modality, key);
  }

  const message = document.createElement("div");
  message.className = "nb-message";

  stage.append(counter, grid, glyph, keys, message);
  root.append(stage);

  // The lit cell is tracked so hiding does not have to touch every cell.
  let litCell: HTMLDivElement | null = null;
  let litShape: SVGPathElement | null = null;

  return {
    showStimulus(values) {
      const index = values.position ?? 0;
      const cell = cells[index];
      if (!cell) return;
      litCell = cell;
      cell.style.background =
        values.color !== undefined ? (COLORS[values.color] as string) : "var(--stimulus)";
      if (values.shape !== undefined) {
        litShape = shapes[index] ?? null;
        litShape?.setAttribute("d", (SHAPES[values.shape] as string) ?? "");
      }
      cell.classList.add("is-lit");
      if (options.showAudioGlyph && values.audio !== undefined) {
        glyph.textContent = AUDIO_GLYPHS[values.audio] ?? "";
      }
    },
    hideStimulus() {
      if (!litCell) return;
      litCell.classList.remove("is-lit");
      litCell.style.background = "";
      litShape?.removeAttribute("d");
      litShape = null;
      litCell = null;
      glyph.textContent = "";
    },
    resetTrial(counterText) {
      counter.textContent = counterText;
      for (const key of keyEls.values()) key.classList.remove("is-pressed");
      stage.classList.remove("is-correct", "is-wrong");
    },
    markPressed(modality) {
      keyEls.get(modality)?.classList.add("is-pressed");
    },
    flashFeedback(correct) {
      stage.classList.add(correct ? "is-correct" : "is-wrong");
    },
    setMessage(title, keyHint, hint) {
      message.innerHTML = "";
      for (const [text, cls] of [
        [title, "nb-title"],
        [keyHint, "nb-keyhint"],
        [hint, "nb-hint"],
      ] as const) {
        const el = document.createElement("div");
        el.className = cls;
        el.textContent = text;
        message.append(el);
      }
    },
    clearMessage() {
      message.innerHTML = "";
    },
    dispose() {
      root.innerHTML = "";
    },
  };
}
