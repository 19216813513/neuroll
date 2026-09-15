import { describe, expect, it } from "vitest";
import {
  buildScales,
  type ChartBox,
  DEFAULT_PADDING,
  finitePoints,
  niceTicks,
  toPath,
} from "./chart";

const box: ChartBox = { width: 400, height: 200, padding: DEFAULT_PADDING };
const plotLeft = DEFAULT_PADDING.left;
const plotRight = box.width - DEFAULT_PADDING.right;
const plotTop = DEFAULT_PADDING.top;
const plotBottom = box.height - DEFAULT_PADDING.bottom;

describe("finitePoints", () => {
  it("drops points a metric could not produce", () => {
    // One NaN reaching the domain would drag the whole axis to NaN and blank the
    // chart — and a NaN metric is normal (an aborted run, an undefined interval).
    const kept = finitePoints([
      { x: 0, y: 1 },
      { x: 1, y: Number.NaN },
      { x: 2, y: Number.POSITIVE_INFINITY },
      { x: 3, y: 4 },
    ]);

    expect(kept).toEqual([
      { x: 0, y: 1 },
      { x: 3, y: 4 },
    ]);
  });
});

describe("buildScales", () => {
  it("puts the first and last runs at the edges of the plot area", () => {
    const scales = buildScales(
      [
        { x: 0, y: 10 },
        { x: 9, y: 20 },
      ],
      box,
    );

    expect(scales.xOf(0)).toBeCloseTo(plotLeft, 6);
    expect(scales.xOf(9)).toBeCloseTo(plotRight, 6);
  });

  it("inverts y, because SVG counts downward", () => {
    const scales = buildScales(
      [
        { x: 0, y: 0 },
        { x: 1, y: 100 },
      ],
      box,
    );

    // A higher score must sit higher on screen; getting this backwards would
    // draw every learning curve upside down.
    expect(scales.yOf(100)).toBeLessThan(scales.yOf(0));
    expect(scales.yOf(100)).toBeGreaterThanOrEqual(plotTop);
    expect(scales.yOf(0)).toBeLessThanOrEqual(plotBottom);
  });

  it("gives a flat series a drawable domain", () => {
    // Five runs at the same score is the normal early case, not an error.
    const scales = buildScales(
      [
        { x: 0, y: 42 },
        { x: 1, y: 42 },
      ],
      box,
    );

    expect(scales.yDomain[0]).toBeLessThan(42);
    expect(scales.yDomain[1]).toBeGreaterThan(42);
    expect(Number.isFinite(scales.yOf(42))).toBe(true);
  });

  it("gives a single point a domain in both axes", () => {
    const scales = buildScales([{ x: 5, y: 5 }], box);

    expect(scales.xDomain[0]).toBeLessThan(5);
    expect(scales.xDomain[1]).toBeGreaterThan(5);
    expect(Number.isFinite(scales.xOf(5))).toBe(true);
    expect(Number.isFinite(scales.yOf(5))).toBe(true);
  });

  it("survives an empty series", () => {
    const scales = buildScales([], box);

    expect(Number.isFinite(scales.xOf(0))).toBe(true);
    expect(Number.isFinite(scales.yOf(0))).toBe(true);
  });

  it("keeps a zero-valued flat series off the axis line", () => {
    // The 0.1x padding rule degenerates at zero, so it falls back to ±1.
    const scales = buildScales([{ x: 0, y: 0 }], box);

    expect(scales.yDomain[0]).toBeLessThan(0);
    expect(scales.yDomain[1]).toBeGreaterThan(0);
  });
});

describe("toPath", () => {
  it("moves to the first point and lines to the rest", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ];
    const path = toPath(points, buildScales(points, box));

    expect(path.startsWith("M")).toBe(true);
    expect(path.match(/L/g)).toHaveLength(2);
    expect(path).not.toContain("NaN");
  });

  it("is empty when there is nothing to draw", () => {
    expect(toPath([], buildScales([], box))).toBe("");
    expect(toPath([{ x: 0, y: Number.NaN }], buildScales([], box))).toBe("");
  });
});

describe("niceTicks", () => {
  it("chooses round steps", () => {
    // The labels are meant to be read at a glance, not decoded: 0, 50, 100 —
    // never 0, 37.5, 75. `count` is a hint, so the tick count may differ from it
    // once the step has been rounded to something sayable.
    expect(niceTicks(0, 100, 4)).toEqual([0, 50, 100]);
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it("stays inside the domain", () => {
    for (const tick of niceTicks(13, 87, 4)) {
      expect(tick).toBeGreaterThanOrEqual(13);
      expect(tick).toBeLessThanOrEqual(87);
    }
  });

  it("does not drift on fractional steps", () => {
    // Repeated addition of 0.1 produces 0.30000000000000004, which renders as a
    // tick label nobody wants to see.
    for (const tick of niceTicks(0, 1, 5)) {
      expect(String(tick).length).toBeLessThan(6);
    }
  });

  it("degenerates gracefully", () => {
    expect(niceTicks(5, 5)).toEqual([5]);
    expect(niceTicks(Number.NaN, 1)).toEqual([]);
  });
});
