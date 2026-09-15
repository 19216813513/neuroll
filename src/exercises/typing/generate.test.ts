import { describe, expect, it } from "vitest";
import { createRng } from "~/core/rng";
import { generateWords, stripMarks } from "./generate";
import { LEVELS, WORDS } from "./words";

const options = {
  level: 600,
  count: 40,
  caps: false,
  punctuation: false,
};

describe("word pool", () => {
  it("has no duplicates", () => {
    // A repeated entry silently doubles that word's draw rate, which changes the
    // difficulty of the level without changing anything visible.
    const seen = new Set(WORDS);
    expect(seen.size).toBe(WORDS.length);
  });

  it("contains only bare lowercase words", () => {
    // Capitals and punctuation are settings. A word carrying its own would make
    // "大文字なし" produce capitals anyway.
    for (const word of WORDS) expect(word).toMatch(/^[a-z]+$/);
  });

  it("is long enough for every level it offers", () => {
    // Otherwise the widest level would quietly be narrower than its own label.
    expect(WORDS.length).toBeGreaterThanOrEqual(Math.max(...LEVELS));
  });
});

describe("generateWords", () => {
  it("is deterministic for a seed", () => {
    // The stored seed has to reproduce the exact text, or a run can never be
    // replayed or re-scored (PLAN §9.4a).
    const a = generateWords(createRng("seed-1"), options);
    const b = generateWords(createRng("seed-1"), options);
    const c = generateWords(createRng("seed-2"), options);

    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("produces exactly the requested number of words", () => {
    expect(generateWords(createRng("n"), { ...options, count: 1 })).toHaveLength(1);
    expect(generateWords(createRng("n"), { ...options, count: 250 })).toHaveLength(250);
  });

  it("draws only from the level's prefix of the pool", () => {
    const narrow = new Set(WORDS.slice(0, 200));
    const words = generateWords(createRng("level"), { ...options, level: 200, count: 300 });

    for (const word of words) expect(narrow.has(stripMarks(word))).toBe(true);
  });

  it("never repeats a word back to back", () => {
    const words = generateWords(createRng("repeat"), { ...options, level: 200, count: 500 });

    for (let i = 1; i < words.length; i++) {
      expect(stripMarks(words[i] as string)).not.toBe(stripMarks(words[i - 1] as string));
    }
  });

  it("emits no capitals or punctuation when both are off", () => {
    const words = generateWords(createRng("plain"), { ...options, count: 300 });

    for (const word of words) expect(word).toMatch(/^[a-z]+$/);
  });

  it("capitalises only the first letter when caps are on", () => {
    const words = generateWords(createRng("caps"), { ...options, caps: true, count: 300 });

    expect(words.some((word) => /^[A-Z]/.test(word))).toBe(true);
    // A capital in the middle would be a different exercise: it is Shift timing
    // mid-word, not sentence casing.
    for (const word of words) expect(word.slice(1)).toMatch(/^[a-z]*[^A-Za-z]?$/);
  });

  it("puts punctuation only at the end of a word, never on the last one", () => {
    const words = generateWords(createRng("punct"), {
      ...options,
      punctuation: true,
      count: 300,
    });

    expect(words.some((word) => /[.,;:!?]$/.test(word))).toBe(true);
    for (const word of words) expect(word).toMatch(/^[A-Za-z]+[.,;:!?]?$/);
    // A trailing mark on the final word would be a keystroke the run can never
    // reach in word-count mode: the space that commits it ends the session.
    expect(words[words.length - 1]).toMatch(/^[A-Za-z]+$/);
  });

  it("starts a sentence with a capital after a full stop", () => {
    const words = generateWords(createRng("sentence"), {
      ...options,
      caps: true,
      punctuation: true,
      count: 400,
    });

    for (let i = 1; i < words.length; i++) {
      if (/[.!?]$/.test(words[i - 1] as string)) {
        expect(words[i]).toMatch(/^[A-Z]/);
      }
    }
  });
});
