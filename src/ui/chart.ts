/**
 * SVG chart geometry.
 *
 * Own SVG, no charting library (PLAN §10). The arithmetic lives here rather than
 * inside a component so the parts that are easy to get quietly wrong — a flat
 * series collapsing to a zero-height domain, a single point with nothing to
 * interpolate, a NaN metric dragging the whole axis to infinity — are testable
 * without rendering anything.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ChartBox {
  width: number;
  height: number;
  padding: Padding;
}

export interface Scales {
  /** Data value → SVG x. */
  xOf(value: number): number;
  /** Data value → SVG y. SVG's y axis points down, so this inverts. */
  yOf(value: number): number;
  xDomain: [number, number];
  yDomain: [number, number];
  box: ChartBox;
}

/**
 * Tick labels sit inside the plot rather than in a left gutter, so the padding
 * does not have to be wide enough for the longest label at whatever font size
 * the viewport ends up using. A gutter sized for a desktop clips "36000" the
 * moment the label grows for a phone.
 */
export const DEFAULT_PADDING: Padding = { top: 16, right: 12, bottom: 20, left: 10 };

/** Drops points a metric could not produce, so one NaN cannot flatten the axis. */
export function finitePoints(points: readonly Point[]): Point[] {
  return points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

/**
 * Widens a degenerate span into something drawable.
 *
 * A series of identical scores is the normal early case, not an error: five runs
 * at the same time to the second would otherwise divide by a zero-height domain
 * and put every point on the same pixel row, or off the canvas entirely.
 */
function padDomain(min: number, max: number): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1;
    return [min - pad, max + pad];
  }
  // A little headroom, so the best and worst points are not welded to the frame.
  const margin = (max - min) * 0.08;
  return [min - margin, max + margin];
}

export function buildScales(points: readonly Point[], box: ChartBox): Scales {
  const usable = finitePoints(points);
  const xs = usable.map((p) => p.x);
  const ys = usable.map((p) => p.y);

  const xDomain: [number, number] =
    xs.length === 0 ? [0, 1] : padDomainX(Math.min(...xs), Math.max(...xs));
  const yDomain = padDomain(
    ys.length === 0 ? 0 : Math.min(...ys),
    ys.length === 0 ? 1 : Math.max(...ys),
  );

  const left = box.padding.left;
  const right = box.width - box.padding.right;
  const top = box.padding.top;
  const bottom = box.height - box.padding.bottom;

  const spanX = xDomain[1] - xDomain[0];
  const spanY = yDomain[1] - yDomain[0];

  return {
    xDomain,
    yDomain,
    box,
    xOf: (value) => left + ((value - xDomain[0]) / spanX) * (right - left),
    yOf: (value) => bottom - ((value - yDomain[0]) / spanY) * (bottom - top),
  };
}

/**
 * The x axis is run order, so it gets no headroom — the first and last runs
 * belong at the edges. It only needs the degenerate case handled.
 */
function padDomainX(min: number, max: number): [number, number] {
  if (min === max) return [min - 0.5, max + 0.5];
  return [min, max];
}

/** Polyline through the points, in order. Empty string when there is nothing. */
export function toPath(points: readonly Point[], scales: Scales): string {
  const usable = finitePoints(points);
  if (usable.length === 0) return "";
  return usable
    .map(
      (p, i) => `${i === 0 ? "M" : "L"}${scales.xOf(p.x).toFixed(2)} ${scales.yOf(p.y).toFixed(2)}`,
    )
    .join(" ");
}

/**
 * Round tick values covering a domain.
 *
 * Steps are chosen from 1/2/5 × a power of ten, which is what makes an axis read
 * as 0, 50, 100 rather than 0, 37.5, 75 — the tick labels are meant to be read at
 * a glance, not decoded.
 */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || count < 1) return [];
  if (min === max) return [min];

  const rawStep = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalised = rawStep / magnitude;
  const step = (normalised > 5 ? 10 : normalised > 2 ? 5 : normalised > 1 ? 2 : 1) * magnitude;

  // Indexed off the first tick rather than accumulated: adding 0.2 repeatedly
  // reaches 0.6000000000000001, and rounding that back to a multiple of 0.2 does
  // not help, because 3 * 0.2 is the same wrong number. Fixing the decimal count
  // the step implies is what actually produces a label worth printing.
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let i = 0; first + i * step <= max + step / 1000; i++) {
    ticks.push(Number((first + i * step).toFixed(decimals)));
  }
  return ticks;
}
