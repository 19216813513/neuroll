/**
 * The typing state machine.
 *
 * Separated from the view because everything interesting about this exercise is
 * bookkeeping, not rendering: which keystrokes count, what "correct" means once a
 * word has been left behind, and how a correction is scored. None of that needs a
 * DOM, so none of it is trapped behind one — the whole rule set is exercised in
 * `engine.test.ts` without a browser.
 *
 * Two independent notions of "correct" live here, and conflating them is the
 * classic way typing scores go wrong:
 *
 *  - **Keystroke correctness** feeds accuracy. A character typed wrong counts
 *    against it forever, even if the participant backspaces and fixes it.
 *  - **Final-state correctness** feeds net WPM. Only what is standing in the text
 *    at the end counts, so a corrected mistake costs time but not characters.
 *
 * Together they are why a run can be 100 WPM at 90% accuracy: the speed is what
 * survived, the accuracy is what it took.
 */

export interface EngineOptions {
  /** strict: a wrong character is refused, so the word cannot be left wrong. */
  strict: boolean;
  allowBackspace: boolean;
}

export type PressKind = "correct" | "wrong" | "rejected" | "commit" | "backspace" | "ignored";

export interface PressResult {
  kind: PressKind;
  /** True when the key was a character attempt, i.e. it feeds accuracy. */
  counted: boolean;
  /** Whether the attempt was right. For a commit, whether the word was perfect. */
  correct: boolean;
  /** The character the text wanted here, or null past the end of a word. */
  expected: string | null;
  typed: string;
  /** Word whose rendering changed, so the view repaints one word, not the page. */
  wordIndex: number;
  charIndex: number;
  finished: boolean;
}

export interface Tally {
  /** Characters standing correct at the end, including committed spaces. */
  correctChars: number;
  /** Characters standing wrong or left unfilled in a committed word. */
  incorrectChars: number;
  /** Character attempts, correct or not. Backspaces are not attempts. */
  typedChars: number;
  correctKeystrokes: number;
  /** Backspaces actually applied. */
  corrections: number;
  /** Words committed with a space. */
  words: number;
}

export interface TypingEngine {
  readonly words: readonly string[];
  press(key: string): PressResult;
  /** Index of the word being typed. */
  wordIndex(): number;
  /** Characters entered for the current word, aligned to its positions. */
  entered(): readonly string[];
  finished(): boolean;
  /**
   * Counts including the word still in progress. Pure with respect to engine
   * state, so calling it twice gives the same answer and a caller can sample
   * mid-run without disturbing anything.
   */
  finalize(): Tally;
}

export function createTypingEngine(words: readonly string[], options: EngineOptions): TypingEngine {
  let index = 0;
  let entered: string[] = [];
  let done = words.length === 0;

  const tally: Tally = {
    correctChars: 0,
    incorrectChars: 0,
    typedChars: 0,
    correctKeystrokes: 0,
    corrections: 0,
    words: 0,
  };

  const currentWord = (): string => words[index] ?? "";

  const result = (kind: PressKind, extra: Partial<PressResult> = {}): PressResult => ({
    kind,
    counted: kind !== "backspace" && kind !== "ignored",
    correct: false,
    expected: null,
    typed: "",
    wordIndex: index,
    charIndex: entered.length,
    finished: done,
    ...extra,
  });

  /** Per-position verdict for a word that is being left behind. */
  function foldWord(word: string, typed: readonly string[], into: Tally, complete: boolean): void {
    const positions = complete ? word.length : typed.length;
    for (let i = 0; i < positions; i++) {
      if (typed[i] === word[i]) into.correctChars++;
      else into.incorrectChars++;
    }
  }

  return {
    words,
    wordIndex: () => index,
    entered: () => entered,
    finished: () => done,

    press(key) {
      if (done) return result("ignored");

      if (key === "Backspace") {
        // Refusing the key is the whole point of the no-backspace setting, so it
        // must not quietly count as a character attempt either way.
        if (!options.allowBackspace || entered.length === 0) return result("ignored");
        entered.pop();
        tally.corrections++;
        return result("backspace", { typed: key, charIndex: entered.length });
      }

      if (key === " ") {
        // A space with nothing entered would commit an empty word and shift the
        // whole text by one, so it is not an attempt at anything.
        if (entered.length === 0) return result("ignored");

        const word = currentWord();
        const perfect = entered.length === word.length && entered.every((c, i) => c === word[i]);

        if (options.strict && !perfect) {
          // In strict mode every entered character is already correct, so this can
          // only mean the word is unfinished. Leaving it would defeat the setting.
          tally.typedChars++;
          return result("rejected", { typed: key, expected: word[entered.length] ?? null });
        }

        foldWord(word, entered, tally, true);
        tally.typedChars++;
        // The separating space is a character too — WPM counts five characters to
        // the word including it — and it is only right if the word it closes was.
        if (perfect) {
          tally.correctChars++;
          tally.correctKeystrokes++;
        } else {
          tally.incorrectChars++;
        }

        tally.words++;
        index++;
        entered = [];
        if (index >= words.length) done = true;
        return result("commit", {
          typed: key,
          correct: perfect,
          wordIndex: index - 1,
          charIndex: word.length,
        });
      }

      // Anything longer than one character is a named key — Shift, ArrowLeft,
      // Enter — and means nothing here. Modifier combinations never reach us:
      // the listener in def.ts leaves those to the browser.
      if (key.length !== 1) return result("ignored");

      const word = currentWord();
      const expected = word[entered.length];

      if (expected === undefined) {
        // Typing past the end of a word. Counted as a miss, but not appended:
        // growing the word would reflow the line under the caret mid-keystroke,
        // which is far more disorienting than the character simply not appearing.
        tally.typedChars++;
        return result("rejected", { typed: key, expected: null });
      }

      tally.typedChars++;
      if (key === expected) {
        tally.correctKeystrokes++;
        entered.push(key);
        return result("correct", {
          typed: key,
          correct: true,
          expected,
          charIndex: entered.length - 1,
        });
      }

      if (options.strict) {
        return result("rejected", { typed: key, expected });
      }

      entered.push(key);
      return result("wrong", { typed: key, expected, charIndex: entered.length - 1 });
    },

    finalize() {
      const final: Tally = { ...tally };
      // The word in progress counts for what is actually standing in it. Its
      // untyped remainder does not: the participant did not skip those letters,
      // the clock simply stopped on them.
      if (!done && entered.length > 0) foldWord(currentWord(), entered, final, false);
      return final;
    },
  };
}
