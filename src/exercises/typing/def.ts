/**
 * Typing (タイピング).
 *
 * Trains processing speed and motor sequence learning: the text is trivial to
 * read, so the whole score is how fast the fingers can execute it.
 *
 * Scope for this first version is PLAN §5.4's English-word material only. The
 * romaji, digit, symbol and weakness-drill materials share this engine and this
 * view, but each needs its own generator, and a 素材 setting with one working
 * option would be a promise the session cannot keep.
 *
 * `timingSensitive` is true, which is worth explaining because no reaction time
 * is measured here. The flag partitions records by device class, and for typing
 * the input device *is* the instrument: a mechanical keyboard, a laptop scissor
 * switch and a phone's on-screen keyboard produce numbers that have no business
 * sharing a leaderboard. Partitioning by device is exactly as necessary as it is
 * for reaction time, just for a different reason.
 */

import { paintAndTimestamp } from "~/core/clock";
import { eventTime, waitForStartSignal } from "~/core/input";
import { AbortError } from "~/core/scheduler";
import type { ExerciseDef, RunResult, SessionContext, TrialRecord } from "~/exercises/types";
import { createTypingEngine, type PressResult } from "./engine";
import { generateWords } from "./generate";
import { scoreTyping } from "./score";
import { LEVELS } from "./words";

type EndMode = "time" | "words";
type CaretShape = "block" | "underline" | "bar";

/**
 * Words generated per second of a timed run.
 *
 * Four words a second is 240 WPM sustained — past the fastest verified typists —
 * so the stream cannot run dry mid-run, while still keeping the DOM to a few
 * thousand spans on the longest setting.
 */
const WORDS_PER_SECOND = 4;

export const typingDef: ExerciseDef = {
  id: "typing",
  name: "タイピング",
  blurb: "英単語を正確に速く打つ。処理速度と運動系列学習。物理キーボード用。",
  instructions: [
    "表示された英単語を上から順に打ちます。単語の区切りはスペースキーです。",
    "日本語入力（IME）は必ずオフにしてください。オンのままだと打鍵が計測できず、記録になりません。",
    "制限時間はタイマー表示ではなく、最初の1打鍵から始まります。問題文を読む時間はスコアに含まれません。",
    "打ち間違いは色で分かります。「進む」設定ではそのまま先へ進み、「止まる」設定では正しい文字を打つまで進みません。",
    "主指標は WPM (net)。最後に画面上で正しく残っている文字だけが数えられるので、速く打っても直さなければ伸びません。逆に、直せば正確さは下がっても速度は保てます。",
    "物理キーボードが前提です。スマートフォンのソフトキーボードでは操作できません。",
  ],
  presets: [
    {
      name: "入門",
      note: "30秒 / 頻出200語",
      config: { level: "200", endMode: "time", durationSec: 30 },
    },
    {
      name: "標準",
      note: "60秒 / 頻出600語",
      config: { level: "600", endMode: "time", durationSec: 60 },
    },
    {
      name: "正確さ重視",
      note: "60秒 / 誤字で停止・訂正不可",
      config: {
        level: "600",
        endMode: "time",
        durationSec: 60,
        onMiss: "strict",
        noBackspace: true,
      },
    },
    {
      name: "実文章",
      note: "60秒 / 大文字と句読点あり",
      config: { level: "600", endMode: "time", durationSec: 60, caps: true, punctuation: true },
    },
  ],
  domains: ["processing-speed"],
  bucketVersion: 1,
  timingSensitive: true,
  higherIsBetter: true,
  primaryMetric: "wpm",
  settings: [
    {
      key: "level",
      label: "語彙レベル",
      kind: "enum",
      affects: "difficulty",
      options: LEVELS.map((size) => ({ value: String(size), label: `頻出${size}語` })),
      default: "600",
      help: "出題される単語の範囲。広いほど見慣れない綴りが混ざり、指が勝手に動かなくなる。",
    },
    {
      key: "endMode",
      label: "終了条件",
      kind: "enum",
      affects: "difficulty",
      options: [
        { value: "time", label: "時間制" },
        { value: "words", label: "語数制" },
      ],
      default: "time",
      help: "時間制は速度、語数制は完走までの正確さが問われる。",
    },
    {
      key: "durationSec",
      label: "制限時間",
      kind: "int",
      affects: "difficulty",
      min: 15,
      max: 120,
      step: 15,
      default: 60,
      unit: "秒",
      visibleWhen: (config) => config.endMode !== "words",
      help: "短いほど一時的な全力が出せる。持久力を見るなら60秒以上。",
    },
    {
      key: "wordCount",
      label: "語数",
      kind: "int",
      affects: "difficulty",
      min: 10,
      max: 100,
      step: 10,
      default: 25,
      visibleWhen: (config) => config.endMode === "words",
    },
    {
      key: "onMiss",
      label: "ミス時の挙動",
      kind: "enum",
      affects: "difficulty",
      options: [
        // The labels carry their own subject because the condition chips shown
        // during a session and on the results screen print the option alone —
        // a bare "進む" there would not say what it is that proceeds.
        { value: "free", label: "誤字スルー" },
        { value: "strict", label: "誤字で停止" },
      ],
      default: "free",
      help: "「誤字で停止」は正しい文字を打つまで先に進めない。速度は落ちるが、誤った運指を覚え込まずに済む。",
    },
    {
      key: "noBackspace",
      label: "訂正不可",
      kind: "bool",
      affects: "difficulty",
      default: false,
      help: "バックスペースを禁止する。一度打った文字がそのまま記録に残るので、初打で当てる訓練になる。",
    },
    {
      key: "caps",
      label: "大文字あり",
      kind: "bool",
      affects: "difficulty",
      default: false,
      help: "文頭などが大文字になる。Shift との同時押しが入るぶん難しくなる。",
    },
    {
      key: "punctuation",
      label: "句読点あり",
      kind: "bool",
      affects: "difficulty",
      default: false,
      help: "カンマやピリオドが混ざる。ホームポジションから外れる記号キーの訓練。",
    },
    {
      key: "lines",
      label: "表示行数",
      kind: "int",
      affects: "cosmetic",
      min: 1,
      max: 3,
      step: 1,
      default: 3,
      advanced: true,
      help: "先の行まで見えると視線が先行できる。1行にすると目の前の単語だけに集中できる。",
    },
    {
      key: "caret",
      label: "カーソル形状",
      kind: "enum",
      affects: "cosmetic",
      options: [
        { value: "block", label: "ブロック" },
        { value: "underline", label: "下線" },
        { value: "bar", label: "縦棒" },
      ],
      default: "block",
      advanced: true,
    },
  ],
  metrics: [
    { key: "wpm", label: "WPM (net)", precision: 1, higherIsBetter: true },
    { key: "wpmGross", label: "WPM (gross)", precision: 1, higherIsBetter: true },
    { key: "accuracy", label: "正確率", unit: "%", precision: 1, higherIsBetter: true },
    { key: "errors", label: "未訂正エラー", unit: "字", precision: 0, higherIsBetter: false },
    { key: "kpm", label: "打鍵速度", unit: "打/分", precision: 0, higherIsBetter: true },
    {
      key: "ikiMedianMs",
      label: "打鍵間隔(中央値)",
      unit: "ms",
      precision: 0,
      higherIsBetter: false,
    },
    { key: "ikiP95Ms", label: "打鍵間隔(p95)", unit: "ms", precision: 0, higherIsBetter: false },
    { key: "ikiCv", label: "一貫性(CV)", precision: 2, higherIsBetter: false },
  ],
  keyHints: (config) => {
    const hints = [{ key: "Space", label: "次の単語へ" }];
    if (config.noBackspace !== true) hints.push({ key: "BS", label: "直前の文字を訂正" });
    return hints;
  },
  run: runTyping,
};

async function runTyping(ctx: SessionContext): Promise<RunResult> {
  const config = ctx.config;
  const endMode = (config.endMode as EndMode) ?? "time";
  const durationSec = config.durationSec as number;
  const allowBackspace = config.noBackspace !== true;

  const wordCount =
    endMode === "words"
      ? (config.wordCount as number)
      : Math.max(60, Math.ceil(durationSec * WORDS_PER_SECOND));

  const words = generateWords(ctx.rng, {
    level: Number(config.level),
    count: wordCount,
    caps: config.caps === true,
    punctuation: config.punctuation === true,
  });

  const engine = createTypingEngine(words, {
    strict: config.onMiss === "strict",
    allowBackspace,
  });

  const view = buildView(ctx.root, {
    words,
    lines: config.lines as number,
    caret: config.caret as CaretShape,
  });

  const records: TrialRecord[] = [];
  const ikiMs: number[] = [];
  const startedAt = performance.now();
  // The clock starts on the first keystroke, not when the text appears: reading
  // the first line is not typing, and charging it to the run would make a short
  // setting score worse than a long one for no reason the participant controls.
  let typingStartedAt: number | null = null;
  let previousKeyAt: number | null = null;
  let finishedAt: number | null = null;

  try {
    view.setMessage(
      "キーを押して開始",
      allowBackspace
        ? "IME はオフに。Space で次の単語へ、BS で訂正。"
        : "IME はオフに。Space で次の単語へ。訂正はできません。",
    );
    await waitForStartSignal(ctx.signal);
    await paintAndTimestamp(() => {
      view.clearMessage();
      view.paintWord(0, engine.entered(), false);
      view.setCaret(0, 0);
      view.setStatus(endMode === "time" ? `${durationSec}` : `0 / ${wordCount}`);
    });

    await new Promise<void>((resolve, reject) => {
      if (ctx.signal.aborted) {
        reject(new AbortError());
        return;
      }

      let frame = 0;
      let shownStatus = "";

      const stop = (): void => {
        window.removeEventListener("keydown", onKeyDown, { capture: true });
        ctx.signal.removeEventListener("abort", onAbort);
        cancelAnimationFrame(frame);
      };
      const onAbort = (): void => {
        stop();
        reject(new AbortError());
      };

      const finish = (at: number): void => {
        finishedAt = at;
        stop();
        resolve();
      };

      const deadline = (): number =>
        typingStartedAt === null ? Number.POSITIVE_INFINITY : typingStartedAt + durationSec * 1000;

      const record = (press: PressResult, at: number): void => {
        if (!press.counted) return;

        // Intervals are measured between character attempts only. A backspace
        // sits between two keystrokes without being one of them, so folding it in
        // would report a rhythm nobody typed.
        const iki = previousKeyAt === null ? null : at - previousKeyAt;
        if (iki !== null) ikiMs.push(iki);
        previousKeyAt = at;

        records.push({
          i: records.length,
          stimulus: { expected: press.expected, word: press.wordIndex, char: press.charIndex },
          // There is no distractor stream here: every position in the text is
          // something the participant is meant to hit.
          isTarget: press.expected !== null,
          response: { typed: press.typed, ikiMs: iki },
          correct: press.correct,
          // Deliberately null. `rtMs` means "latency from a stimulus", and the
          // plausibility check in scores/validate.ts reads it as one — a typing
          // interval of 80ms is excellent, not implausible, so reporting IKIs
          // here would flag every good run as machine input. The interval is
          // kept on the response instead, where it says what it is.
          rtMs: null,
          presentedAt: at - startedAt,
        });
      };

      const onKeyDown = (event: KeyboardEvent): void => {
        // Shortcuts stay with the browser, and Escape stays with the session
        // shell's quit handler.
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key === "Escape") return;

        // With an IME active the browser reports composition keys rather than the
        // characters typed, so the run cannot be measured. PLAN §5.4 excludes IME
        // input for exactly this reason; say so rather than silently dropping keys.
        if (event.isComposing || event.key === "Process") {
          event.preventDefault();
          view.setWarning("日本語入力がオンになっています。IME をオフにしてください。");
          return;
        }

        const key = event.key;
        if (key !== "Backspace" && key.length !== 1) return;
        event.preventDefault();

        const at = eventTime(event);
        if (typingStartedAt === null) {
          // Backspace with nothing typed is not the start of anything.
          if (key === "Backspace") return;
          typingStartedAt = at;
        } else if (endMode === "time" && at > deadline()) {
          // The key landed after time was up but before the frame that notices.
          // Counting it would let a late press extend the run.
          finish(deadline());
          return;
        }

        view.clearWarning();
        const before = engine.wordIndex();
        // Committing clears the engine's buffer, so the word being left behind
        // has to be painted from what it held a moment ago.
        const enteredBefore = [...engine.entered()];
        const press = engine.press(key);
        record(press, at);

        if (press.kind === "commit") {
          view.paintWord(press.wordIndex, enteredBefore, true);
          view.paintWord(engine.wordIndex(), engine.entered(), false);
          view.scrollTo(engine.wordIndex());
        } else {
          view.paintWord(before, engine.entered(), false);
        }
        view.setCaret(engine.wordIndex(), engine.entered().length);

        if (engine.finished()) finish(at);
      };

      const tick = (timestamp: number): void => {
        if (endMode === "time" && typingStartedAt !== null) {
          const remainingMs = deadline() - timestamp;
          if (remainingMs <= 0) {
            finish(deadline());
            return;
          }
          const seconds = String(Math.ceil(remainingMs / 1000));
          // Writing the same string every frame would dirty the text node 60
          // times a second for nothing.
          if (seconds !== shownStatus) {
            shownStatus = seconds;
            view.setStatus(seconds);
          }
          ctx.onProgress?.(1 - remainingMs / (durationSec * 1000));
        } else if (endMode === "words") {
          const status = `${engine.wordIndex()} / ${wordCount}`;
          if (status !== shownStatus) {
            shownStatus = status;
            view.setStatus(status);
          }
          ctx.onProgress?.(engine.wordIndex() / wordCount);
        }
        frame = requestAnimationFrame(tick);
      };

      window.addEventListener("keydown", onKeyDown, { capture: true });
      ctx.signal.addEventListener("abort", onAbort, { once: true });
      frame = requestAnimationFrame(tick);
    });
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

  const elapsedMs =
    typingStartedAt === null ? 0 : Math.max(0, (finishedAt ?? performance.now()) - typingStartedAt);

  return {
    ...scoreTyping(engine.finalize(), ikiMs, elapsedMs),
    trials: records,
    durationMs: performance.now() - startedAt,
  };
}

interface ViewOptions {
  words: readonly string[];
  lines: number;
  caret: CaretShape;
}

interface TypingView {
  /** Repaints one word from the characters entered for it. */
  paintWord(index: number, entered: readonly string[], committed: boolean): void;
  setCaret(wordIndex: number, charIndex: number): void;
  scrollTo(wordIndex: number): void;
  setStatus(text: string): void;
  setMessage(title: string, hint: string): void;
  clearMessage(): void;
  setWarning(text: string): void;
  clearWarning(): void;
  dispose(): void;
}

function buildView(root: HTMLElement, options: ViewOptions): TypingView {
  root.innerHTML = "";

  const stage = document.createElement("div");
  stage.className = "tp-stage";

  const status = document.createElement("div");
  status.className = "tp-status";

  const viewport = document.createElement("div");
  viewport.className = "tp-viewport";
  viewport.style.setProperty("--tp-lines", String(options.lines));

  const text = document.createElement("div");
  text.className = `tp-text is-caret-${options.caret}`;

  // Built once. Every keystroke then touches only the class list of the handful
  // of spans that changed, which keeps the input path off the layout engine.
  const wordEls: HTMLElement[] = [];
  for (const word of options.words) {
    const wordEl = document.createElement("span");
    wordEl.className = "tp-word";
    for (const char of word) {
      const charEl = document.createElement("span");
      charEl.className = "tp-char";
      charEl.textContent = char;
      wordEl.append(charEl);
    }
    text.append(wordEl);
    wordEls.push(wordEl);
  }

  const message = document.createElement("div");
  message.className = "tp-message";
  const warning = document.createElement("div");
  warning.className = "tp-warning";

  viewport.append(text);
  stage.append(status, viewport, warning, message);
  root.append(stage);

  let caretChar: HTMLElement | null = null;
  let caretWord: HTMLElement | null = null;
  let offsetTop: number | null = null;

  return {
    paintWord(index, entered, committed) {
      const wordEl = wordEls[index];
      if (!wordEl) return;
      const word = options.words[index] as string;
      wordEl.classList.toggle("is-active", !committed);
      const chars = wordEl.children;
      for (let i = 0; i < chars.length; i++) {
        const charEl = chars[i] as HTMLElement;
        const typed = entered[i];
        charEl.classList.remove("is-correct", "is-wrong", "is-missing");

        // A wrong character shows what was typed, not what was wanted. Colouring
        // the expected letter red says only "not that", which is no help at all
        // when the mistake was a neighbouring key: seeing the "r" you hit is what
        // tells you your hand was one column off.
        const shown = typed !== undefined && typed !== word[i] ? typed : (word[i] as string);
        if (charEl.textContent !== shown) charEl.textContent = shown;

        if (typed === undefined) {
          // Only a word that has been left behind has missing characters; in the
          // word being typed they are simply not written yet.
          if (committed) charEl.classList.add("is-missing");
        } else if (typed === word[i]) {
          charEl.classList.add("is-correct");
        } else {
          charEl.classList.add("is-wrong");
        }
      }
    },

    setCaret(wordIndex, charIndex) {
      caretChar?.classList.remove("is-caret");
      caretWord?.classList.remove("is-caret-end");
      caretChar = null;
      caretWord = null;

      const wordEl = wordEls[wordIndex];
      if (!wordEl) return;
      const charEl = wordEl.children[charIndex] as HTMLElement | undefined;
      if (charEl) {
        charEl.classList.add("is-caret");
        caretChar = charEl;
      } else {
        // Past the last character: the word is fully typed and waiting for the
        // space, so the caret sits on the word's trailing edge.
        wordEl.classList.add("is-caret-end");
        caretWord = wordEl;
      }
    },

    scrollTo(wordIndex) {
      const wordEl = wordEls[wordIndex];
      const firstEl = wordEls[0];
      if (!wordEl || !firstEl) return;

      // Measured against the first word rather than read absolutely. `offsetTop`
      // is relative to the nearest *positioned* ancestor, and which element that
      // is changes underneath this code: the session shell is `position: fixed`,
      // so until `.tp-text` has a transform of its own the offset is the distance
      // from the top of the screen — a few hundred pixels — and scrolling by it
      // threw the text right out of the viewport on the first space. Applying the
      // transform then made `.tp-text` the offsetParent, so the next space
      // measured 0 and threw it back. Two sibling words always share whatever
      // ancestor that is, so their difference is the distance within the text and
      // nothing else.
      const top = wordEl.offsetTop - firstEl.offsetTop;

      // Only when the active word has actually wrapped onto a new line. Scrolling
      // on every word would make the text creep under the caret continuously.
      if (offsetTop === top) return;
      offsetTop = top;
      text.style.transform = `translateY(${-top}px)`;
    },

    setStatus(value) {
      status.textContent = value;
    },

    setMessage(title, hint) {
      message.innerHTML = "";
      const t = document.createElement("div");
      t.className = "tp-title";
      t.textContent = title;
      const h = document.createElement("div");
      h.className = "tp-hint";
      h.textContent = hint;
      message.append(t, h);
    },

    clearMessage() {
      message.innerHTML = "";
    },

    setWarning(value) {
      warning.textContent = value;
    },

    clearWarning() {
      if (warning.textContent !== "") warning.textContent = "";
    },

    dispose() {
      root.innerHTML = "";
    },
  };
}
