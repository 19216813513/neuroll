import { describe, expect, it } from "vitest";
import { nbackDef } from "~/exercises/nback/def";
import type { Run } from "~/store/types";
import {
  ANY,
  applyFilters,
  defaultFilters,
  deviceOptions,
  filterableSettings,
  freeAxis,
  groupByAxis,
  optionsFor,
  periodStart,
  rankRuns,
} from "./highscore";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-15T12:00:00+09:00").getTime();

function run(overrides: Partial<Run> & { primaryScore: number }): Run {
  return {
    id: `run-${overrides.primaryScore}-${overrides.startedAt ?? 0}`,
    schemaVersion: 1,
    userId: "u",
    deviceId: "d",
    exerciseId: "nback",
    bucketVersion: 1,
    scoreBucket: "bucket",
    configSnapshot: { n: 2, modalities: ["position"] },
    seed: "seed",
    deviceProfile: {
      deviceClass: "desktop-keyboard",
      refreshRateHz: 60,
      refreshRateMeasured: true,
      clockResolutionMs: 0.005,
      screen: { width: 1920, height: 1080, dpr: 1 },
      platform: "test",
      measuredAt: 0,
    },
    startedAt: NOW,
    durationMs: 1000,
    metrics: {},
    valid: true,
    suspicion: [],
    appVersion: "test",
    updatedAt: 0,
    ...overrides,
  };
}

const nSetting = filterableSettings(nbackDef).find((s) => s.key === "n");

describe("filterableSettings", () => {
  it("offers exactly the settings that make a bucket", () => {
    // If these two lists ever diverge, a filter would promise to separate runs
    // that are in fact filed together, or vice versa.
    const filterKeys = filterableSettings(nbackDef).map((s) => s.key);
    const bucketKeys = nbackDef.settings
      .filter((s) => s.affects === "difficulty")
      .map((s) => s.key);
    expect(filterKeys).toEqual(bucketKeys);
    expect(filterKeys).not.toContain("showFixation");
  });
});

describe("defaultFilters", () => {
  it("opens on an exact match of the config in hand", () => {
    const filters = defaultFilters(nbackDef, { n: 3, modalities: ["position", "audio"] });

    // Not ANY: the default view must never mix conditions that are not comparable.
    for (const setting of filterableSettings(nbackDef)) {
      expect(filters.settings[setting.key]).not.toBe(ANY);
    }
    expect(filters.includeInvalid).toBe(false);
    expect(filters.period).toBe("all");
  });

  it("treats a multi setting as order-independent", () => {
    // ["audio","position"] is the same task as ["position","audio"], and a filter
    // that disagreed would hide half the history.
    const a = defaultFilters(nbackDef, { modalities: ["position", "audio"] });
    const b = defaultFilters(nbackDef, { modalities: ["audio", "position"] });
    expect(a.settings.modalities).toBe(b.settings.modalities);
  });
});

describe("optionsFor", () => {
  it("offers only values that were actually played, with their counts", () => {
    const runs = [
      run({ primaryScore: 1, configSnapshot: { n: 2 } }),
      run({ primaryScore: 2, configSnapshot: { n: 2 }, startedAt: NOW - 1 }),
      run({ primaryScore: 3, configSnapshot: { n: 3 }, startedAt: NOW - 2 }),
    ];

    const options = optionsFor(runs, nSetting as never);
    // A dropdown listing N=1..9 when six were never attempted is a list of dead ends.
    expect(options).toHaveLength(2);
    expect(options.map((o) => o.label)).toEqual(["2", "3"]);
    expect(options.map((o) => o.count)).toEqual([2, 1]);
  });

  it("orders numeric values numerically", () => {
    const runs = [15, 120, 30, 60].map((n, i) =>
      run({ primaryScore: i, configSnapshot: { n }, startedAt: NOW - i }),
    );

    // String ordering would read 120, 15, 30, 60.
    expect(optionsFor(runs, nSetting as never).map((o) => o.label)).toEqual([
      "15",
      "30",
      "60",
      "120",
    ]);
  });
});

describe("applyFilters", () => {
  const runs = [
    run({ primaryScore: 1, configSnapshot: { n: 2 }, startedAt: NOW - 1 }),
    run({ primaryScore: 2, configSnapshot: { n: 3 }, startedAt: NOW - 2 }),
    run({ primaryScore: 3, configSnapshot: { n: 2 }, startedAt: NOW - 40 * DAY }),
    run({ primaryScore: 4, configSnapshot: { n: 2 }, valid: false, startedAt: NOW - 3 }),
    run({ primaryScore: 5, configSnapshot: { n: 2 }, deletedAt: NOW, startedAt: NOW - 4 }),
  ];
  const base = { settings: {}, device: ANY, period: "all" as const, includeInvalid: false };

  it("excludes invalid and deleted runs by default", () => {
    const kept = applyFilters(nbackDef, runs, base, NOW);

    // An interrupted run has a plausible-looking score; ranking it would park a
    // bogus number at the top of the table forever.
    expect(kept.map((r) => r.primaryScore).sort()).toEqual([1, 2, 3]);
  });

  it("can include invalid runs, but never deleted ones", () => {
    const kept = applyFilters(nbackDef, runs, { ...base, includeInvalid: true }, NOW);

    expect(kept.map((r) => r.primaryScore).sort()).toEqual([1, 2, 3, 4]);
  });

  it("narrows to one setting value", () => {
    const filters = { ...base, settings: defaultFilters(nbackDef, { n: 3 }).settings };
    // Only `n` is pinned for this assertion; the rest come from the same config.
    const kept = applyFilters(nbackDef, [runs[0] as Run, runs[1] as Run], filters, NOW);

    expect(kept.map((r) => r.primaryScore)).toEqual([2]);
  });

  it("applies the period window", () => {
    const kept = applyFilters(nbackDef, runs, { ...base, period: "30d" }, NOW);

    expect(kept.map((r) => r.primaryScore).sort()).toEqual([1, 2]);
  });

  it("filters by device class", () => {
    const mobile = run({
      primaryScore: 9,
      startedAt: NOW - 5,
      deviceProfile: { ...(runs[0] as Run).deviceProfile, deviceClass: "mobile-touch" },
    });
    const kept = applyFilters(
      nbackDef,
      [...runs, mobile],
      { ...base, device: "mobile-touch" },
      NOW,
    );

    expect(kept.map((r) => r.primaryScore)).toEqual([9]);
  });

  it("ignores runs from another exercise", () => {
    const other = run({ primaryScore: 99, exerciseId: "schulte", startedAt: NOW - 6 });
    const kept = applyFilters(nbackDef, [...runs, other], base, NOW);

    expect(kept.map((r) => r.primaryScore)).not.toContain(99);
  });
});

describe("periodStart", () => {
  it("starts today at local midnight, not 24 hours ago", () => {
    const start = periodStart("today", NOW) as number;
    const midnight = new Date(NOW);
    midnight.setHours(0, 0, 0, 0);

    expect(start).toBe(midnight.getTime());
  });

  it("has no lower bound for all time", () => {
    expect(periodStart("all", NOW)).toBeNull();
  });
});

describe("rankRuns", () => {
  it("ranks a higher-is-better metric downward from the best", () => {
    const ranked = rankRuns(
      [run({ primaryScore: 1 }), run({ primaryScore: 3 }), run({ primaryScore: 2 })],
      true,
    );

    expect(ranked.map((r) => r.run.primaryScore)).toEqual([3, 2, 1]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("ranks a lower-is-better metric upward from the best", () => {
    // Getting this backwards would invert every leaderboard for Schulte and
    // reaction time, where the best score is the smallest.
    const ranked = rankRuns(
      [run({ primaryScore: 1 }), run({ primaryScore: 3 }), run({ primaryScore: 2 })],
      false,
    );

    expect(ranked.map((r) => r.run.primaryScore)).toEqual([1, 2, 3]);
  });

  it("gives tied scores the same rank and skips the next", () => {
    const ranked = rankRuns(
      [
        run({ primaryScore: 5 }),
        run({ primaryScore: 5, startedAt: NOW - 1 }),
        run({ primaryScore: 4 }),
      ],
      true,
    );

    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
    // The earlier of the tied runs is listed first: it got there first.
    expect((ranked[0] as { run: Run }).run.startedAt).toBeLessThan(
      (ranked[1] as { run: Run }).run.startedAt,
    );
  });

  it("returns an empty list for no runs", () => {
    expect(rankRuns([], true)).toEqual([]);
  });
});

describe("freeAxis", () => {
  it("is the single setting left open", () => {
    const filters = defaultFilters(nbackDef, { n: 2 });
    filters.settings.n = ANY;

    expect(freeAxis(nbackDef, filters)?.key).toBe("n");
  });

  it("is nothing when two settings are open", () => {
    // "Best at each value of N" has a reading; "best at each combination of N and
    // ISI" is a pivot table, which is a different view (PLAN §7.2 view 2).
    const filters = defaultFilters(nbackDef, { n: 2 });
    filters.settings.n = ANY;
    filters.settings.isiMs = ANY;

    expect(freeAxis(nbackDef, filters)).toBeNull();
  });

  it("is nothing when everything is pinned", () => {
    expect(freeAxis(nbackDef, defaultFilters(nbackDef, { n: 2 }))).toBeNull();
  });
});

describe("groupByAxis", () => {
  it("returns the best run at each value of the axis, in axis order", () => {
    const runs = [
      run({ primaryScore: 1.0, configSnapshot: { n: 2 }, startedAt: NOW - 1 }),
      run({ primaryScore: 2.5, configSnapshot: { n: 2 }, startedAt: NOW - 2 }),
      run({ primaryScore: 0.8, configSnapshot: { n: 3 }, startedAt: NOW - 3 }),
      run({ primaryScore: 3.3, configSnapshot: { n: 1 }, startedAt: NOW - 4 }),
    ];

    const groups = groupByAxis(runs, nSetting as never, true);

    expect(groups.map((g) => g.label)).toEqual(["1", "2", "3"]);
    expect(groups.map((g) => g.best.primaryScore)).toEqual([3.3, 2.5, 0.8]);
    expect(groups.map((g) => g.count)).toEqual([1, 2, 1]);
  });

  it("takes the minimum when lower is better", () => {
    const runs = [
      run({ primaryScore: 900, configSnapshot: { n: 2 }, startedAt: NOW - 1 }),
      run({ primaryScore: 700, configSnapshot: { n: 2 }, startedAt: NOW - 2 }),
    ];

    expect(groupByAxis(runs, nSetting as never, false)[0]?.best.primaryScore).toBe(700);
  });
});

describe("deviceOptions", () => {
  it("lists the device classes present in the history", () => {
    const mobile = run({
      primaryScore: 1,
      deviceProfile: { ...run({ primaryScore: 0 }).deviceProfile, deviceClass: "mobile-touch" },
    });
    const options = deviceOptions([run({ primaryScore: 2 }), mobile]);

    expect(options.map((o) => o.value).sort()).toEqual(["desktop-keyboard", "mobile-touch"]);
  });
});
