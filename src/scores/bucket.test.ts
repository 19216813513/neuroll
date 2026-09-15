import { describe, expect, it } from "vitest";
import { nbackDef } from "~/exercises/nback/def";
import type { Config, ExerciseDef } from "~/exercises/types";
import {
  computeBucket,
  describeBucket,
  distinguishLabels,
  formatSettingValue,
  isWithinTolerance,
  stableHash,
} from "./bucket";

const def: ExerciseDef = {
  id: "test",
  name: "Test",
  blurb: "",
  instructions: [],
  presets: [],
  domains: ["working-memory"],
  bucketVersion: 1,
  settings: [
    {
      key: "n",
      label: "N",
      kind: "int",
      min: 1,
      max: 9,
      step: 1,
      default: 2,
      affects: "difficulty",
    },
    {
      key: "isi",
      label: "ISI",
      kind: "ms",
      min: 500,
      max: 5000,
      step: 50,
      default: 2500,
      unit: "ms",
      affects: "difficulty",
      tolerance: 0.1,
    },
    {
      key: "modalities",
      label: "モダリティ",
      kind: "multi",
      options: [
        { value: "position", label: "位置" },
        { value: "audio", label: "音" },
      ],
      default: ["position", "audio"],
      affects: "difficulty",
    },
    {
      key: "adaptive",
      label: "適応モード",
      kind: "bool",
      default: true,
      affects: "difficulty",
    },
    {
      key: "volume",
      label: "音量",
      kind: "int",
      min: 0,
      max: 100,
      step: 5,
      default: 70,
      affects: "cosmetic",
    },
    {
      key: "theme",
      label: "配色",
      kind: "enum",
      options: [
        { value: "dark", label: "ダーク" },
        { value: "light", label: "ライト" },
      ],
      default: "dark",
      affects: "cosmetic",
    },
  ],
  metrics: [],
  primaryMetric: "dPrime",
  higherIsBetter: true,
  timingSensitive: true,
  run: async () => ({ metrics: {}, primaryScore: 0, trials: [], durationMs: 0 }),
};

const base: Config = {
  n: 2,
  isi: 2500,
  modalities: ["position", "audio"],
  adaptive: true,
  volume: 70,
  theme: "dark",
};

describe("stableHash", () => {
  it("is deterministic", () => {
    expect(stableHash("hello")).toBe(stableHash("hello"));
  });

  it("returns 128 bits of hex", () => {
    expect(stableHash("hello")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("separates inputs differing by one character", () => {
    expect(stableHash("bucket-a")).not.toBe(stableHash("bucket-b"));
    expect(stableHash("")).not.toBe(stableHash(" "));
  });

  it("has no collisions across many similar inputs", () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 20000; i++) hashes.add(stableHash(`config-${i}`));
    expect(hashes.size).toBe(20000);
  });
});

describe("computeBucket", () => {
  it("is stable across calls", () => {
    expect(computeBucket({ def, config: base, deviceClass: "desktop-keyboard" })).toBe(
      computeBucket({ def, config: base, deviceClass: "desktop-keyboard" }),
    );
  });

  it("ignores the insertion order of config keys", () => {
    const reordered: Config = {
      theme: "dark",
      adaptive: true,
      volume: 70,
      modalities: ["position", "audio"],
      isi: 2500,
      n: 2,
    };
    expect(computeBucket({ def, config: reordered, deviceClass: "desktop-keyboard" })).toBe(
      computeBucket({ def, config: base, deviceClass: "desktop-keyboard" }),
    );
  });

  it("ignores the order within a multi-select", () => {
    const swapped: Config = { ...base, modalities: ["audio", "position"] };
    expect(computeBucket({ def, config: swapped, deviceClass: "desktop-keyboard" })).toBe(
      computeBucket({ def, config: base, deviceClass: "desktop-keyboard" }),
    );
  });

  it("changes when a difficulty setting changes", () => {
    const harder: Config = { ...base, n: 3 };
    expect(computeBucket({ def, config: harder, deviceClass: "desktop-keyboard" })).not.toBe(
      computeBucket({ def, config: base, deviceClass: "desktop-keyboard" }),
    );
  });

  it("does NOT change when only cosmetic settings change", () => {
    const restyled: Config = { ...base, volume: 20, theme: "light" };
    expect(computeBucket({ def, config: restyled, deviceClass: "desktop-keyboard" })).toBe(
      computeBucket({ def, config: base, deviceClass: "desktop-keyboard" }),
    );
  });

  it("separates device classes for timing-sensitive exercises", () => {
    expect(computeBucket({ def, config: base, deviceClass: "mobile-touch" })).not.toBe(
      computeBucket({ def, config: base, deviceClass: "desktop-keyboard" }),
    );
  });

  it("ignores device class when the exercise is not timing sensitive", () => {
    const untimed: ExerciseDef = { ...def, timingSensitive: false };
    expect(computeBucket({ def: untimed, config: base, deviceClass: "mobile-touch" })).toBe(
      computeBucket({ def: untimed, config: base, deviceClass: "desktop-keyboard" }),
    );
  });

  it("changes when bucketVersion is bumped", () => {
    const v2: ExerciseDef = { ...def, bucketVersion: 2 };
    expect(computeBucket({ def: v2, config: base, deviceClass: "desktop-keyboard" })).not.toBe(
      computeBucket({ def, config: base, deviceClass: "desktop-keyboard" }),
    );
  });

  it("treats 2500 and 2500.0000000000005 as the same bucket", () => {
    const drifted: Config = { ...base, isi: 2500.0000000000005 };
    expect(computeBucket({ def, config: drifted, deviceClass: "desktop-keyboard" })).toBe(
      computeBucket({ def, config: base, deviceClass: "desktop-keyboard" }),
    );
  });
});

describe("describeBucket", () => {
  it("lists difficulty settings only", () => {
    const label = describeBucket(def, base);
    expect(label).toContain("N 2");
    expect(label).toContain("2500ms");
    expect(label).toContain("位置+音");
    expect(label).not.toContain("音量");
    expect(label).not.toContain("ダーク");
  });

  it("omits a setting that is hidden for the config in hand", () => {
    const gated: ExerciseDef = {
      ...def,
      settings: [
        ...def.settings,
        {
          key: "gridSize",
          label: "グリッド",
          kind: "enum",
          options: [
            { value: "2", label: "2×2" },
            { value: "3", label: "3×3" },
          ],
          default: "3",
          affects: "difficulty",
          visibleWhen: (config) => (config.modalities as string[]).includes("position"),
        },
      ],
    };

    expect(describeBucket(gated, { ...base, gridSize: "2" })).toContain("2×2");
    // Nothing was placed in a grid, so the label must not claim one.
    const noPosition: Config = { ...base, modalities: ["audio"], gridSize: "2" };
    expect(describeBucket(gated, noPosition)).not.toContain("2×2");
  });

  it("omits a false boolean and includes a true one", () => {
    expect(describeBucket(def, { ...base, adaptive: false })).not.toContain("適応モード");
    expect(describeBucket(def, base)).toContain("適応モード");
  });
});

describe("isWithinTolerance", () => {
  it("accepts a numeric difference inside the declared tolerance", () => {
    // ISI tolerance is 10%, so 2500 vs 2400 is within range.
    expect(isWithinTolerance(def, base, { ...base, isi: 2400 })).toBe(true);
  });

  it("rejects a numeric difference beyond the tolerance", () => {
    expect(isWithinTolerance(def, base, { ...base, isi: 1500 })).toBe(false);
  });

  it("requires exact equality for settings with no tolerance", () => {
    expect(isWithinTolerance(def, base, { ...base, n: 3 })).toBe(false);
  });

  it("requires exact equality for enums, bools and multis", () => {
    expect(isWithinTolerance(def, base, { ...base, adaptive: false })).toBe(false);
    expect(isWithinTolerance(def, base, { ...base, modalities: ["position"] })).toBe(false);
  });

  it("ignores cosmetic differences", () => {
    expect(isWithinTolerance(def, base, { ...base, volume: 0, theme: "light" })).toBe(true);
  });
});

describe("records missing a setting", () => {
  // Not hypothetical: N-back gained `gridSize` after records already existed, so
  // every older run has a config without it.
  const olderRun = { modalities: ["position"], n: 2 };

  it("describes the missing setting by its default instead of printing undefined", () => {
    const summary = describeBucket(nbackDef, olderRun);

    expect(summary).not.toContain("undefined");
    expect(summary).not.toContain("NaN");
  });

  it("formats a missing value as the default", () => {
    const gridSize = nbackDef.settings.find((s) => s.key === "gridSize");
    expect(formatSettingValue(gridSize as never, undefined)).toBe(
      formatSettingValue(gridSize as never, (gridSize as { default: unknown }).default),
    );
  });
});

describe("distinguishLabels", () => {
  const at = (n: number): Config => ({
    modalities: ["position"],
    n,
    trials: 20,
    isiMs: 2500,
    stimulusMs: 500,
    targetRate: 25,
    lureRate: 0,
    gridSize: "3",
  });

  it("names only the setting that differs", () => {
    // The whole point of the control is telling the options apart; repeating the
    // eighty characters they share defeats it.
    const labels = distinguishLabels(nbackDef, [at(1), at(2), at(3)]);

    expect(labels).toEqual(["N 1", "N 2", "N 3"]);
  });

  it("names every differing setting when more than one varies", () => {
    const labels = distinguishLabels(nbackDef, [at(2), { ...at(3), isiMs: 2000 }]);

    expect(labels[0]).toContain("N 2");
    expect(labels[0]).toContain("刺激間間隔 2500ms");
    expect(labels[1]).toContain("N 3");
    expect(labels[1]).toContain("刺激間間隔 2000ms");
  });

  it("keeps labels distinct when a differing setting is off in one config", () => {
    // summariseDifficulty is right to leave an unset flag unsaid, but a picker
    // built that way would show two options with the same label.
    const labels = distinguishLabels(nbackDef, [at(2), { ...at(2), gridSize: "2" }]);

    expect(new Set(labels).size).toBe(2);
  });

  it("falls back to the full description for a single config", () => {
    const labels = distinguishLabels(nbackDef, [at(2)]);

    expect(labels[0]).toBe(describeBucket(nbackDef, at(2)));
  });

  it("falls back to the full description when nothing differs", () => {
    // Identical settings mean the configs are separated by something outside
    // them, and the caller has to add that itself.
    const labels = distinguishLabels(nbackDef, [at(2), at(2)]);

    expect(labels[0]).toBe(labels[1]);
    expect(labels[0]).toBe(describeBucket(nbackDef, at(2)));
  });
});
