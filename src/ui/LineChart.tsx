/**
 * Line chart with a hover readout.
 *
 * Own SVG, per PLAN §10: no charting dependency, and no animation — the point of
 * the learning curve is to be read, not watched. Hovering names the exact run
 * under the pointer, because "is this line going up" is answered by the shape but
 * "was that Tuesday's run" is not.
 *
 * The drawing happens in a fixed viewBox that scales to the container, so the
 * geometry never has to be recomputed on resize and no layout measurement sits in
 * the render path.
 */

import { useState } from "preact/hooks";
import {
  buildScales,
  type ChartBox,
  DEFAULT_PADDING,
  finitePoints,
  niceTicks,
  type Point,
  toPath,
} from "./chart";

const VIEW_WIDTH = 720;
const VIEW_HEIGHT = 260;
const BOX: ChartBox = { width: VIEW_WIDTH, height: VIEW_HEIGHT, padding: DEFAULT_PADDING };

interface Props {
  /** Raw series. `x` is run order, `y` the metric. */
  points: readonly Point[];
  /** Smoothed overlay drawn on top of the raw points. */
  average?: readonly Point[];
  /** Formats a y value for the axis and the readout. */
  formatValue: (value: number) => string;
  /** Formats the x of a hovered point, e.g. as its date. */
  formatPoint?: (index: number) => string;
  emptyMessage?: string;
}

export function LineChart({
  points,
  average = [],
  formatValue,
  formatPoint,
  emptyMessage = "記録がありません",
}: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const usable = finitePoints(points);

  if (usable.length === 0) {
    return <p class="muted">{emptyMessage}</p>;
  }

  const scales = buildScales([...usable, ...finitePoints(average)], BOX);
  const ticks = niceTicks(scales.yDomain[0], scales.yDomain[1], 4);

  const onMove = (event: PointerEvent): void => {
    const svg = event.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    // Client pixels → viewBox units. The viewBox scales uniformly, so one ratio
    // is enough and no per-axis correction is needed.
    const x = ((event.clientX - rect.left) / rect.width) * VIEW_WIDTH;

    let nearest = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    usable.forEach((point, index) => {
      const distance = Math.abs(scales.xOf(point.x) - x);
      if (distance < bestDistance) {
        bestDistance = distance;
        nearest = index;
      }
    });
    setHover(nearest);
  };

  const hovered = hover === null ? null : usable[hover];

  return (
    <div class="chart">
      <svg
        class="chart-svg"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-label="学習曲線"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <title>学習曲線</title>

        {ticks.map((tick) => (
          <g key={tick}>
            <line
              class="chart-grid"
              x1={DEFAULT_PADDING.left}
              x2={VIEW_WIDTH - DEFAULT_PADDING.right}
              y1={scales.yOf(tick)}
              y2={scales.yOf(tick)}
            />
            {/* Above its own gridline and anchored to the left edge: a label
                that starts inside the plot cannot be clipped by the viewBox,
                whatever size the font scales to. */}
            <text class="chart-tick" x={DEFAULT_PADDING.left + 2} y={scales.yOf(tick) - 3}>
              {formatValue(tick)}
            </text>
          </g>
        ))}

        <path class="chart-line" d={toPath(usable, scales)} />
        {average.length > 0 && <path class="chart-average" d={toPath(average, scales)} />}

        {usable.map((point) => (
          <circle
            key={point.x}
            class="chart-point"
            cx={scales.xOf(point.x)}
            cy={scales.yOf(point.y)}
            r={3}
          />
        ))}

        {hovered && (
          <g>
            <line
              class="chart-crosshair"
              x1={scales.xOf(hovered.x)}
              x2={scales.xOf(hovered.x)}
              y1={DEFAULT_PADDING.top}
              y2={VIEW_HEIGHT - DEFAULT_PADDING.bottom}
            />
            <circle
              class="chart-point is-hovered"
              cx={scales.xOf(hovered.x)}
              cy={scales.yOf(hovered.y)}
              r={5}
            />
          </g>
        )}
      </svg>

      {/* The readout sits outside the SVG so it wraps and reflows like text
          rather than needing to be measured and clamped inside the viewBox. */}
      <div class="chart-readout">
        {hovered ? (
          <>
            <span class="chart-readout-value">{formatValue(hovered.y)}</span>
            <span class="faint">{formatPoint?.(hovered.x) ?? `${hovered.x + 1} 回目`}</span>
          </>
        ) : (
          <span class="faint">グラフにカーソルを合わせると各回の値が出ます</span>
        )}
      </div>
    </div>
  );
}
