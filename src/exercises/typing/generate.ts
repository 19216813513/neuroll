/**
 * Text generation for the typing exercise.
 *
 * Pure and seeded: the same seed and config always produce the same words, which
 * is what lets a stored run be replayed or re-scored later (PLAN §9.4a). No
 * browser API is touched here so the generator stays testable and server-runnable.
 */

import type { Rng } from "~/core/rng";
import { WORDS } from "./words";

export interface GenerateOptions {
  /** Vocabulary size: words are drawn from the first `level` of the pool. */
  level: number;
  /** How many words to produce. */
  count: number;
  /** Sprinkle capitals, so the run exercises Shift. */
  caps: boolean;
  /** Sprinkle punctuation, so the run exercises the symbol row. */
  punctuation: boolean;
}

/** Probability that a word ends with a punctuation mark, when enabled. */
const PUNCTUATION_RATE = 0.15;
/** Probability that a word starts with a capital, when caps are enabled. */
const CAPITAL_RATE = 0.12;

/**
 * Marks that end a sentence. Weighted by hand rather than drawn uniformly: a
 * text where every seventh word ends in "!" does not read like English, and the
 * point of punctuation practice is the keys people actually hit.
 */
const TERMINATORS = [".", ".", ".", ".", "?", "!"] as const;
const SEPARATORS = [",", ",", ";", ":"] as const;

const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * Draws `count` words from the pool.
 *
 * Immediate repeats are rejected: the same word twice in a row is easier to type
 * than two different ones (the motor sequence is already loaded) and reads as a
 * rendering bug, so it would cost difficulty and trust at once.
 */
export function generateWords(rng: Rng, options: GenerateOptions): string[] {
  const level = Math.max(1, Math.min(options.level, WORDS.length));
  const pool = WORDS.slice(0, level);
  const words: string[] = [];

  // The word after a full stop is capitalised regardless of CAPITAL_RATE, since
  // a sentence that starts lowercase looks like a mistake in the prompt itself.
  let startsSentence = options.caps;

  for (let i = 0; i < options.count; i++) {
    let word = rng.pick(pool);
    const previous = words[words.length - 1];
    if (pool.length > 1 && previous !== undefined && stripMarks(previous) === word) {
      word = rng.pick(pool);
    }

    if (options.caps && (startsSentence || rng.chance(CAPITAL_RATE))) {
      word = capitalize(word);
    }
    startsSentence = false;

    if (options.punctuation && i < options.count - 1 && rng.chance(PUNCTUATION_RATE)) {
      // A separator keeps the sentence running; a terminator ends it, which is
      // what re-arms the capital on the next word.
      const terminate = rng.chance(0.6);
      const mark = terminate ? rng.pick(TERMINATORS) : rng.pick(SEPARATORS);
      word += mark;
      if (terminate && options.caps) startsSentence = true;
    }

    // Pushed with its marks; `stripMarks` above is what keeps the repeat check
    // comparing bare words rather than decorations.
    words.push(word);
  }

  return words;
}

/** The bare word behind any capital or trailing mark. */
export function stripMarks(word: string): string {
  return word.replace(/[^A-Za-z]/g, "").toLowerCase();
}
