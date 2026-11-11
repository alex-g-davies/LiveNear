import { formatUsdCompact } from "../lib/format";

interface Props {
  history: [string, number][] | null;
}

const W = 280;
const H = 120;
const PAD = { top: 10, right: 8, bottom: 18, left: 44 };

/** Readable SVG line chart of a ZIP's quarterly price history (009 R4) —
 * a real chart with min/max gridlines, unlike the popup sparkline. */
export default function PriceChart({ history }: Props) {
  if (!history || history.length < 2) {
    return <p className="chart-empty">No price history for this ZIP.</p>;
  }

  const values = history.map(([, v]) => v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const x = (i: number) => PAD.left + (i / (history.length - 1)) * innerW;
  const y = (v: number) => PAD.top + (1 - (v - min) / span) * innerH;

  const points = history.map(([, v], i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const rising = values[values.length - 1] >= values[0];
  const trend = rising ? "up" : "down"; // colours come from --positive / --negative (027 R10)
  const area = [
    `${PAD.left},${(PAD.top + innerH).toFixed(1)}`,
    ...points,
    `${(PAD.left + innerW).toFixed(1)},${(PAD.top + innerH).toFixed(1)}`,
  ].join(" ");

  const firstQ = history[0][0];
  const lastQ = history[history.length - 1][0];

  return (
    <svg
      className="chart"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Median value by quarter, ${firstQ} to ${lastQ}`}
    >
      {[max, min].map((v) => (
        <g key={v}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(v)}
            y2={y(v)}
            className="chart__grid"
            strokeDasharray="3 3"
          />
          <text x={PAD.left - 6} y={y(v) + 3.5} textAnchor="end" className="chart__tick">
            {formatUsdCompact(v)}
          </text>
        </g>
      ))}
      <polygon points={area} className={`chart__area--${trend}`} opacity={0.08} />
      <polyline points={points.join(" ")} fill="none" className={`chart__line--${trend}`} strokeWidth={2} />
      <text x={PAD.left} y={H - 4} className="chart__tick">
        {firstQ}
      </text>
      <text x={W - PAD.right} y={H - 4} textAnchor="end" className="chart__tick">
        {lastQ}
      </text>
    </svg>
  );
}
