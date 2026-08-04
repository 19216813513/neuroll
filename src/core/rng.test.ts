import { describe, expect, it } from "vitest";
import { createRng, newSeed } from "./rng";

describe("createRng", () => {
  it("is deterministic: the same seed replays the same stream", () => {
    const a = createRng("seed-abc");
    const b = createRng("seed-abc");
    const left = Array.from({ length: 200 }, () => a.next());
    const right = Array.from({ length: 200 }, () => b.next());
    expect(left).toEqual(right);
  });

  it("produces unrelated streams for seeds differing by one character", () => {
    const a = createRng("seed-abc");
    const b = createRng("seed-abd");
    const left = Array.from({ length: 50 }, () => a.next());
    const right = Array.from({ length: 50 }, () => b.next());
    expect(left).not.toEqual(right);
    // A shared prefix would mean the seed mixer is too weak.
    expect(left[0]).not.toBeCloseTo(right[0] as number, 6);
  });

  it("stays within [0, 1)", () => {
    const rng = createRng("bounds");
    for (let i = 0; i < 20000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is roughly uniform across 10 buckets", () => {
    const rng = createRng("uniformity");
    const n = 100000;
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < n; i++) buckets[Math.floor(rng.next() * 10)]++;
    // Expected 10000 per bucket; allow generous slack so this never flakes.
    for (const count of buckets) {
      expect(count).toBeGreaterThan(9000);
      expect(count).toBeLessThan(11000);
    }
  });

  it("int() covers the full range and never reaches the bound", () => {
    const rng = createRng("int");
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = rng.int(6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });

  it("int() rejects invalid bounds", () => {
    const rng = createRng("guard");
    expect(() => rng.int(0)).toThrow(RangeError);
    expect(() => rng.int(-3)).toThrow(RangeError);
    expect(() => rng.int(2.5)).toThrow(RangeError);
  });

  it("range() is inclusive on both ends", () => {
    const rng = createRng("range");
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = rng.range(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
  });

  it("chance() approximates the requested probability", () => {
    const rng = createRng("chance");
    let hits = 0;
    const n = 50000;
    for (let i = 0; i < n; i++) if (rng.chance(0.25)) hits++;
    expect(hits / n).toBeGreaterThan(0.24);
    expect(hits / n).toBeLessThan(0.26);
  });

  it("chance(0) never fires and chance(1) always fires", () => {
    const rng = createRng("chance-edges");
    for (let i = 0; i < 1000; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it("shuffle() permutes without mutating the input", () => {
    const rng = createRng("shuffle");
    const input = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
    const out = rng.shuffle(input);
    expect(out).not.toBe(input);
    expect([...out].sort((x, y) => x - y)).toEqual([...input]);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("shuffle() reaches every permutation of a small array", () => {
    const rng = createRng("perms");
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(rng.shuffle([1, 2, 3]).join(""));
    expect(seen.size).toBe(6);
  });

  it("pick() rejects an empty array", () => {
    expect(() => createRng("pick").pick([])).toThrow(RangeError);
  });
});

describe("newSeed", () => {
  it("returns distinct 20-char hex seeds", () => {
    const seeds = new Set(Array.from({ length: 1000 }, () => newSeed()));
    expect(seeds.size).toBe(1000);
    for (const seed of seeds) expect(seed).toMatch(/^[0-9a-f]{20}$/);
  });
});
