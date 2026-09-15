import { describe, expect, it } from "vitest";
import { createTypingEngine, type EngineOptions } from "./engine";

const free: EngineOptions = { strict: false, allowBackspace: true };

/** Types a string one key at a time, as the listener would. */
function type(engine: ReturnType<typeof createTypingEngine>, keys: string): void {
  for (const key of keys) engine.press(key);
}

describe("typing engine", () => {
  it("counts a perfectly typed word, and its separating space, as correct", () => {
    const engine = createTypingEngine(["the", "cat"], free);
    type(engine, "the ");

    const tally = engine.finalize();
    // Three letters plus the space: WPM counts five characters to a word
    // including the separator, so dropping it would understate every score.
    expect(tally.correctChars).toBe(4);
    expect(tally.incorrectChars).toBe(0);
    expect(tally.words).toBe(1);
    expect(engine.wordIndex()).toBe(1);
  });

  it("keeps a wrong character in free mode and marks it wrong", () => {
    const engine = createTypingEngine(["the"], free);
    type(engine, "tge ");

    const tally = engine.finalize();
    expect(tally.correctChars).toBe(2);
    // The wrong letter, and the space is wrong too because the word was not.
    expect(tally.incorrectChars).toBe(2);
    expect(tally.correctKeystrokes).toBe(2);
    expect(tally.typedChars).toBe(4);
  });

  it("refuses a wrong character in strict mode", () => {
    const engine = createTypingEngine(["the"], { strict: true, allowBackspace: true });
    const wrong = engine.press("x");

    expect(wrong.kind).toBe("rejected");
    expect(engine.entered()).toEqual([]);
    // Refused, but still a miss: accuracy has to see it.
    expect(engine.finalize().typedChars).toBe(1);

    type(engine, "the ");
    expect(engine.finalize().correctChars).toBe(4);
  });

  it("will not let strict mode leave a word unfinished", () => {
    const engine = createTypingEngine(["the", "cat"], { strict: true, allowBackspace: true });
    type(engine, "th ");

    // The space was refused, so the run is still on the first word.
    expect(engine.wordIndex()).toBe(0);
    expect(engine.entered()).toEqual(["t", "h"]);
  });

  it("charges a correction to accuracy but not to the text", () => {
    const engine = createTypingEngine(["the"], free);
    type(engine, "tg");
    engine.press("Backspace");
    type(engine, "he ");

    const tally = engine.finalize();
    // The final text is perfect, so net WPM is untouched...
    expect(tally.correctChars).toBe(4);
    expect(tally.incorrectChars).toBe(0);
    // ...but the wrong keystroke is still on the record.
    expect(tally.correctKeystrokes).toBe(4);
    expect(tally.typedChars).toBe(5);
    expect(tally.corrections).toBe(1);
  });

  it("ignores backspace entirely when corrections are forbidden", () => {
    const engine = createTypingEngine(["the"], { strict: false, allowBackspace: false });
    type(engine, "tg");
    const press = engine.press("Backspace");

    expect(press.kind).toBe("ignored");
    expect(engine.entered()).toEqual(["t", "g"]);
    // A refused backspace is not a character attempt, so it must not touch
    // accuracy in either direction.
    expect(engine.finalize().typedChars).toBe(2);
    expect(engine.finalize().corrections).toBe(0);
  });

  it("does not backspace past the start of the current word", () => {
    const engine = createTypingEngine(["the", "cat"], free);
    type(engine, "the ");
    const press = engine.press("Backspace");

    // Reopening a committed word would mean re-scoring characters already
    // counted, so the word boundary is a floor.
    expect(press.kind).toBe("ignored");
    expect(engine.wordIndex()).toBe(1);
    expect(engine.finalize().correctChars).toBe(4);
  });

  it("counts characters typed past the end of a word without showing them", () => {
    const engine = createTypingEngine(["the"], free);
    type(engine, "thee");

    // Appending would reflow the line under the caret mid-keystroke.
    expect(engine.entered()).toEqual(["t", "h", "e"]);
    const tally = engine.finalize();
    expect(tally.typedChars).toBe(4);
    expect(tally.correctKeystrokes).toBe(3);
  });

  it("counts letters left unfilled in a committed word as errors", () => {
    const engine = createTypingEngine(["there"], free);
    type(engine, "the ");

    const tally = engine.finalize();
    expect(tally.correctChars).toBe(3);
    // "r" and "e" skipped, plus the space that closed a wrong word.
    expect(tally.incorrectChars).toBe(3);
  });

  it("does not charge the unfinished word for letters the clock cut off", () => {
    const engine = createTypingEngine(["there"], free);
    type(engine, "the");

    const tally = engine.finalize();
    expect(tally.correctChars).toBe(3);
    // Time ran out mid-word; the participant did not skip "re".
    expect(tally.incorrectChars).toBe(0);
    expect(tally.words).toBe(0);
  });

  it("ignores a space with nothing entered", () => {
    const engine = createTypingEngine(["the", "cat"], free);
    const press = engine.press(" ");

    // Committing an empty word would shift the whole text by one.
    expect(press.kind).toBe("ignored");
    expect(engine.wordIndex()).toBe(0);
    expect(engine.finalize().typedChars).toBe(0);
  });

  it("ignores named keys", () => {
    const engine = createTypingEngine(["the"], free);
    for (const key of ["Shift", "ArrowLeft", "Enter", "F5", "Tab"]) {
      expect(engine.press(key).kind).toBe("ignored");
    }
    expect(engine.finalize().typedChars).toBe(0);
  });

  it("finishes when the last word is committed and then ignores everything", () => {
    const engine = createTypingEngine(["the", "cat"], free);
    type(engine, "the cat ");

    expect(engine.finished()).toBe(true);
    const before = engine.finalize();
    expect(engine.press("x").kind).toBe("ignored");
    // A keystroke after the end must not alter a score already reported.
    expect(engine.finalize()).toEqual(before);
  });

  it("reports the same tally however many times it is sampled", () => {
    const engine = createTypingEngine(["the", "cat"], free);
    type(engine, "the ca");

    expect(engine.finalize()).toEqual(engine.finalize());
  });

  it("marks a commit correct only when the word was perfect", () => {
    const engine = createTypingEngine(["the", "the"], free);
    type(engine, "the");
    expect(engine.press(" ").correct).toBe(true);

    type(engine, "teh");
    expect(engine.press(" ").correct).toBe(false);
  });
});
