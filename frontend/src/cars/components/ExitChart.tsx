// Detail-screen chart: this option vs the best lease and best new option for
// the same model at 12/24/36/48 months, with the user's exit odds as bars
// along the bottom.

import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";

import type { ExitMonthKey, OptionSummary } from "../api";
import { measureDef } from "../lib/measures";
import type { Measure } from "../lib/profile";

interface Props {
  option: OptionSummary;
  bestLease: OptionSummary | null;
  bestNew: OptionSummary | null;
  measure: Measure;
  exitOdds: Record<ExitMonthKey, number>;
}

const W = 560;
const H = 270;
const M = { top: 16, right: 24, bottom: 70, left: 76 };
const EXITS: ExitMonthKey[] = ["12", "24", "36", "48"];

export default function ExitChart({ option, bestLease, bestNew, measure, exitOdds }: Props) {
  const def = measureDef(measure);
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const series = [
    { key: "this", label: "This option", opt: option, stroke: "#1F2328", width: 3, dash: undefined },
    { key: "lease", label: "Best lease, same model", opt: bestLease, stroke: "#6E7781", width: 2, dash: "7 5" },
    { key: "new", label: "Best new, same model", opt: bestNew, stroke: "#8C959F", width: 2, dash: "2 4" },
  ].filter((s): s is typeof s & { opt: OptionSummary } => s.opt !== null);

  const points = series.map((s) => ({
    ...s,
    pts: EXITS.map((k) => ({ m: Number(k), v: s.opt.result.measures[measure].band.p50[Number(k)] })),
  }));
  const yMax = Math.max(1, ...points.flatMap((s) => s.pts.map((p) => p.v)));
  const x = scaleLinear().domain([12, 48]).range([innerW * 0.08, innerW * 0.92]);
  const y = scaleLinear().domain([0, yMax * 1.1]).range([innerH, 0]).nice();
  const gen = line<{ m: number; v: number }>()
    .x((p) => x(p.m))
    .y((p) => y(p.v));
  const oddsMax = Math.max(0.01, ...EXITS.map((k) => exitOdds[k]));
  const barH = (k: ExitMonthKey) => (exitOdds[k] / oddsMax) * 26;

  const aria =
    `${def.label} at exit after 12, 24, 36 and 48 months. This option: ` +
    points[0].pts.map((p) => `${p.m} months ${def.format(p.v)}`).join(", ") +
    (bestLease ? `; best lease for this model at 36 months ${def.format(bestLease.result.measures[measure].band.p50[36])}` : "") +
    (bestNew ? `; best new for this model at 36 months ${def.format(bestNew.result.measures[measure].band.p50[36])}` : "") +
    ".";

  return (
    <div className="cars-exitchart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={aria} className="cars-exitchart__svg">
        <g transform={`translate(${M.left},${M.top})`}>
          {y.ticks(4).map((tv) => (
            <g key={tv} transform={`translate(0,${y(tv)})`}>
              <line x1={0} x2={innerW} stroke={tv === 0 ? "#D0D7DE" : "#EAEEF2"} />
              <text x={-8} dy="0.32em" textAnchor="end" className="cars-curves__tick">
                {def.key === "per_km" ? def.format(tv) : `${Math.round(tv / 100).toLocaleString("nb-NO")}`}
              </text>
            </g>
          ))}
          <text transform={`translate(${-M.left + 12},${innerH / 2}) rotate(-90)`} textAnchor="middle" className="cars-curves__axis">
            {def.unit}
          </text>
          {points
            .slice()
            .reverse()
            .map((s) => (
              <path
                key={s.key}
                d={gen(s.pts) ?? undefined}
                fill="none"
                stroke={s.stroke}
                strokeWidth={s.width}
                strokeDasharray={s.dash}
                strokeLinecap="round"
              >
                <title>{s.label}</title>
              </path>
            ))}
          {EXITS.map((k) => (
            <g key={k} transform={`translate(${x(Number(k))},${innerH})`}>
              <text y={18} textAnchor="middle" className="cars-curves__tick">
                {k} mo
              </text>
              <rect x={-12} y={52 - barH(k)} width={24} height={barH(k)} fill="#AFB8C1">
                <title>{`Odds of leaving at ${k} months: ${Math.round(exitOdds[k] * 100)} %`}</title>
              </rect>
            </g>
          ))}
          <text x={0} y={innerH + 66} className="cars-curves__tick">
            Bars: your odds of leaving at each point
          </text>
        </g>
      </svg>
      <div className="cars-legend">
        {series.map((s) => (
          <span key={s.key} className="cars-legend__item">
            <span
              aria-hidden="true"
              className="cars-legend__swatch"
              style={{ borderTopStyle: s.dash ? (s.key === "new" ? "dotted" : "dashed") : "solid", borderTopColor: s.stroke }}
            />
            {s.label}
          </span>
        ))}
        {!bestLease && <span className="cars-legend__item cars-hint">No lease offer for this model</span>}
        {!bestNew && <span className="cars-legend__item cars-hint">No buy-new option for this model</span>}
      </div>
    </div>
  );
}
