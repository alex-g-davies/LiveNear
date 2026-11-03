// Detail-screen chart: this option vs the best lease and best new option for
// the same model by month of exit (6..60) on the central path, the user's
// exit odds as bars along the bottom, and the shared exit marker. The marker
// month is the one the tiles and "Where the money goes" are computed at, so
// every number on the Detail screen reads off the same point of this chart.

import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";

import type { ExitMonthKey, OptionSummary } from "../api";
import { formatYears } from "../lib/format";
import { measureDef } from "../lib/measures";
import type { Measure } from "../lib/profile";

interface Props {
  option: OptionSummary;
  bestLease: OptionSummary | null;
  bestNew: OptionSummary | null;
  measure: Measure;
  exitOdds: Record<ExitMonthKey, number>;
  exitMonth: number;
}

const W = 560;
const H = 270;
const M = { top: 16, right: 24, bottom: 70, left: 76 };
const EXITS: ExitMonthKey[] = ["12", "24", "36", "48"];
const FIRST_MONTH = 6;
const LAST_MONTH = 60;

export default function ExitChart({ option, bestLease, bestNew, measure, exitOdds, exitMonth }: Props) {
  const def = measureDef(measure);
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const series = [
    { key: "this", label: "This option", opt: option, stroke: "#1F2328", width: 3, dash: undefined },
    { key: "lease", label: "Best lease, same model", opt: bestLease, stroke: "#6E7781", width: 2, dash: "7 5" },
    { key: "new", label: "Best new, same model", opt: bestNew, stroke: "#8C959F", width: 2, dash: "2 4" },
  ].filter((s): s is typeof s & { opt: OptionSummary } => s.opt !== null);

  const months: number[] = [];
  for (let m = FIRST_MONTH; m <= LAST_MONTH; m++) months.push(m);
  const points = series.map((s) => {
    const det = s.opt.result.measures[measure].deterministic;
    return { ...s, pts: months.map((m) => ({ m, v: det[m] })).filter((p) => Number.isFinite(p.v)) };
  });
  const yMax = Math.max(1, ...points.flatMap((s) => s.pts.map((p) => p.v)));
  const x = scaleLinear().domain([FIRST_MONTH, LAST_MONTH]).range([0, innerW]);
  const y = scaleLinear().domain([0, yMax * 1.1]).range([innerH, 0]).nice();
  const gen = line<{ m: number; v: number }>()
    .x((p) => x(p.m))
    .y((p) => y(p.v));
  const oddsMax = Math.max(0.01, ...EXITS.map((k) => exitOdds[k]));
  const barH = (k: ExitMonthKey) => (exitOdds[k] / oddsMax) * 26;
  const marker = Math.min(LAST_MONTH, Math.max(FIRST_MONTH, exitMonth));
  const markerX = x(marker);
  const thisAtMarker = option.result.measures[measure].deterministic[marker];

  const aria =
    `${def.label} by month of exit from ${FIRST_MONTH} to ${LAST_MONTH} months. This option at exit after ` +
    `12, 24, 36 and 48 months: ` +
    EXITS.map((k) => `${k} months ${def.format(option.result.measures[measure].deterministic[Number(k)])}`).join(", ") +
    (bestLease
      ? `; best lease for this model at 36 months ${def.format(bestLease.result.measures[measure].deterministic[36])}`
      : "") +
    (bestNew ? `; best new for this model at 36 months ${def.format(bestNew.result.measures[measure].deterministic[36])}` : "") +
    `. Exit marker at ${formatYears(marker / 12)}: ${def.format(thisAtMarker)}.`;

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
                strokeLinejoin="round"
                data-testid={`exit-line-${s.key}`}
              >
                <title>{s.label}</title>
              </path>
            ))}
          <g data-testid="exit-marker" transform={`translate(${markerX},0)`}>
            <line y1={0} y2={innerH} stroke="#0B5CD5" strokeDasharray="4 4" strokeWidth={1.5} />
            {Number.isFinite(thisAtMarker) && <circle cy={y(thisAtMarker)} r={5} fill="#0B5CD5" stroke="#fff" strokeWidth={2} />}
            <text
              y={-4}
              textAnchor={markerX > innerW * 0.8 ? "end" : "start"}
              dx={markerX > innerW * 0.8 ? -6 : 6}
              className="cars-curves__tick"
              fill="#0B5CD5"
            >
              Leave at {formatYears(marker / 12)}
            </text>
          </g>
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
