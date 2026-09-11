/**
 * The stimulus alphabets, and the one thing that must stay true of all of them.
 *
 * Alphabet size is a difficulty setting wearing no label: with k choices, a
 * non-target trial lands on the n±1 value about 1/k of the time by accident, so
 * a small alphabet manufactures lures the participant never asked for and a
 * large one makes plain familiarity a workable strategy. When two streams run
 * at once they are therefore two different tasks unless their alphabets match —
 * and the results screen puts `dPrime_color` next to `dPrime_shape` as though
 * they were the same one.
 *
 * The sizes drifted apart once already (6 colours, 8 tones, 10 shapes), which is
 * what this file exists to stop happening quietly a second time.
 */

import { describe, expect, it } from "vitest";
import { AUDIO_ALPHABET_SIZE } from "~/core/audio";
import { COLORS, SHAPES } from "./def";

/**
 * CIE76 ΔE between two hex colours.
 *
 * Crude by modern standards — ΔE2000 exists and is better behaved — but the
 * question here is only "would anyone mistake these two for each other", and
 * ΔE76 answers that far better than comparing hex strings or hue angles, which
 * is what let a near-duplicate through in the first place.
 */
function labDistance(first: string, second: string): number {
  const [l1, a1, b1] = toLab(first);
  const [l2, a2, b2] = toLab(second);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Every unordered pair, so the checks below read as one loop instead of two. */
function* pairs(values: readonly string[]): Generator<[string, string]> {
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      yield [values[i] as string, values[j] as string];
    }
  }
}

function toHsl(hex: string): { h: number; s: number; l: number } {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;

  return { h, s: delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1)), l };
}

function toLab(hex: string): [number, number, number] {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(1);
  const g = channel(3);
  const b = channel(5);

  // sRGB to XYZ (D65), then XYZ to Lab.
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);

  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

describe("stimulus alphabets", () => {
  it("are the same size across every non-positional modality", () => {
    expect(COLORS).toHaveLength(AUDIO_ALPHABET_SIZE);
    expect(SHAPES).toHaveLength(AUDIO_ALPHABET_SIZE);
  });

  it("holds eight of each, matching the classic dual n-back", () => {
    // Position is the deliberate exception: the grid is 4, 9 or 16, and taking
    // the centre out of a 3x3 to reach 8 would change the difficulty of the
    // default configuration and orphan every record made under it.
    expect(AUDIO_ALPHABET_SIZE).toBe(8);
  });

  it("has no repeated colour", () => {
    // A duplicate would silently shrink the alphabet: two indices that look the
    // same are one stimulus as far as the participant is concerned.
    expect(new Set(COLORS).size).toBe(COLORS.length);
  });

  it("has no near-duplicate colour", () => {
    // Coarse, and knowingly so: CIE76 under-weights differences between saturated
    // colours, which is exactly why it is not the only check here. It catches the
    // blunt mistake — something close to a copy of an entry already in the list.
    const tooClose: string[] = [];
    for (const [a, b] of pairs(COLORS)) {
      const separation = labDistance(a, b);
      if (separation <= 30) tooClose.push(`${a}/${b} (ΔE ${separation.toFixed(0)})`);
    }
    expect(tooClose).toEqual([]);
  });

  it("has no two colours that differ in hue alone", () => {
    // The check that earns its place. An eighth colour chosen by eye was a pink
    // 31 degrees of hue from the existing red at the same lightness and
    // saturation — ΔE 38, comfortably past the test above, and still two stimuli
    // a 500ms exposure would merge. Colours that share a tone have to be far
    // apart on the wheel, or differ by something other than the wheel.
    const sameTone: string[] = [];
    for (const [a, b] of pairs(COLORS)) {
      const first = toHsl(a);
      const second = toHsl(b);
      let hue = Math.abs(first.h - second.h);
      if (hue > 180) hue = 360 - hue;
      const lightness = Math.abs(first.l - second.l);
      const saturation = Math.abs(first.s - second.s);
      if (hue < 40 && lightness < 0.1 && saturation < 0.15) {
        sameTone.push(`${a}/${b} (hue ${hue.toFixed(0)}°, L ${lightness.toFixed(2)})`);
      }
    }
    expect(sameTone).toEqual([]);
  });

  it("has no repeated shape", () => {
    expect(new Set(SHAPES).size).toBe(SHAPES.length);
  });

  it("draws every shape as a closed path", () => {
    for (const path of SHAPES) {
      expect(path.startsWith("M")).toBe(true);
      expect(path.endsWith("Z")).toBe(true);
    }
  });
});
