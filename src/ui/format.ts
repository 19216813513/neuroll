/**
 * Display formatting shared by the screens that show scores.
 *
 * Small, but shared on purpose: three screens print the same numbers, and a
 * metric rendered to two decimals on one screen and none on another reads as two
 * different measurements of the same thing.
 */

/** A metric value, or an em dash when the run could not produce one. */
export function formatMetric(value: number | undefined, precision = 0): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(precision);
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** Local date and time. Wall clock, which is what "when did I play this" means. */
export function formatDateTime(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDate(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Direction of a regression slope, read as improvement.
 *
 * `higherIsBetter` is what makes a falling completion time an improvement rather
 * than a decline; without it every time-based exercise would report backwards.
 */
export function trendArrow(slope: number, higherIsBetter: boolean): string {
  const directed = higherIsBetter ? slope : -slope;
  if (Math.abs(directed) < 1e-6) return "→";
  return directed > 0 ? "↗ 改善" : "↘ 低下";
}
