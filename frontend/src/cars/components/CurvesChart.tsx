// Cost curves (spec 022 R11): x = years of ownership 0.5–5, y = the selected
// measure. One line per option, colour by car, dash by way to get it,
// P10–P90 band as a translucent area, end labels with a collision nudge and
// a dashed exit marker. React owns the SVG; d3 supplies scales and paths.

import { max } from "d3-array";
import { scaleLinear } from "d3-scale";
import { area, line } from "d3-shape";
import { useMemo } from "react";

import type { OptionSummary } from "../api";
import { useContainerWidth } from "../hooks/useContainerWidth";
import { decimal } from "../../i18n/dates";
import { useT } from "../../i18n/react";
import { formatYears } from "../lib/format";
import { MODE_LABELS, measureDef, modeDash } from "../lib/measures";
import type { Measure } from "../lib/profile";

export const CURVE_FIRST_MONTH = 6;
export const CURVE_LAST_MONTH = 60;

interface Props {
  options: OptionSummary[];
  measure: Measure;
  showBands: boolean;
  exitMonth: number;
  colorOf: (variantId: string) => string;
}

interface Pt {
  t: number;
  p10: number;
  p50: number;
  p90: number;
}

const HEIGHT = 380;
const MARGIN = { top: 20, right: 170, bottom: 40, left: 84 };
const LABEL_GAP = 30;

function compactValue(def: ReturnType<typeof measureDef>, v: number): string {
  if (def.key === "per_km") return def.format(v);
  const kr = v / 100;
  if (Math.abs(kr) >= 1_000_000) return `${(kr / 1_000_000).toFixed(1).replace(".", ",")} M kr`;
  if (Math.abs(kr) >= 10_000) return `${Math.round(kr / 1000)} k kr`;
  return def.format(v);
}

export default function CurvesChart({ options, measure, showBands, exitMonth, colorOf }: Props) {
  const { t } = useT();
  const { ref, width } = useContainerWidth<HTMLDivElement>(800);
  const def = measureDef(measure);
  const innerW = Math.max(120, width - MARGIN.left - MARGIN.right);
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

  const series = useMemo(
    () =>
      options.map((o) => {
        const m = o.result.measures[measure];
        const pts: Pt[] = [];
        for (let t = CURVE_FIRST_MONTH; t <= CURVE_LAST_MONTH; t++) {
          const p50 = m.band.p50[t];
          if (!Number.isFinite(p50)) continue;
          pts.push({ t, p10: m.band.p10[t] ?? p50, p50, p90: m.band.p90[t] ?? p50 });
        }
        return { option: o, pts, color: colorOf(o.variant_id) };
      }),
    [options, measure, colorOf],
  );

  const yMax = useMemo(() => {
    const top = max(series, (s) => max(s.pts, (p) => (showBands ? p.p90 : p.p50))) ?? 0;
    return top > 0 ? top * 1.05 : 1;
  }, [series, showBands]);

  const x = scaleLinear().domain([CURVE_FIRST_MONTH / 12, CURVE_LAST_MONTH / 12]).range([0, innerW]);
  const y = scaleLinear().domain([0, yMax]).range([innerH, 0]).nice();

  const lineGen = line<Pt>()
    .x((p) => x(p.t / 12))
    .y((p) => y(p.p50));
  const areaGen = area<Pt>()
    .x((p) => x(p.t / 12))
    .y0((p) => y(p.p10))
    .y1((p) => y(p.p90));

  // End labels: sort by final y, push apart by LABEL_GAP, then pull back up
  // if the stack overflows the bottom of the plot.
  const labels = useMemo(() => {
    const items = series
      .filter((s) => s.pts.length)
      .map((s) => {
        const last = s.pts[s.pts.length - 1];
        return { s, y: y(last.p50) };
      })
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) {
      if (items[i].y < items[i - 1].y + LABEL_GAP) items[i].y = items[i - 1].y + LABEL_GAP;
    }
    const overflow = items.length ? items[items.length - 1].y - innerH : 0;
    if (overflow > 0) for (const it of items) it.y -= overflow;
    return items;
    // y is rebuilt each render; depending on its inputs keeps the memo honest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, innerH, yMax]);

  const exitYears = exitMonth / 12;
  const exitX = x(exitYears);
  const atExit = series
    .map((s) => ({ s, v: s.option.result.measures[measure].band.p50[exitMonth] }))
    .filter((d) => Number.isFinite(d.v))
    .sort((a, b) => a.v - b.v);
  const lowest = atExit[0];
  const ariaLabel =
    t("carsCompare.curves.aria", {
      measure: def.label,
      count: series.length,
      from: decimal(String(CURVE_FIRST_MONTH / 12)),
      to: decimal(String(CURVE_LAST_MONTH / 12)),
      bands: showBands ? t("carsCompare.curves.withBands") : t("carsCompare.curves.withoutBands"),
      years: formatYears(exitYears),
    }) +
    (lowest
      ? ` ${t("carsCompare.curves.ariaLowest", {
          label: lowest.s.option.result.label,
          mode: MODE_LABELS[lowest.s.option.option_kind],
          value: def.format(lowest.v),
        })}`
      : "");

  const yTicks = y.ticks(5);
  const xTicks = [1, 2, 3, 4, 5];

  return (
    <div ref={ref} className="cars-curves">
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={ariaLabel}
        className="cars-curves__svg"
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {yTicks.map((tv) => (
            <g key={tv} transform={`translate(0,${y(tv)})`}>
              <line x1={0} x2={innerW} stroke={tv === 0 ? "var(--c-border)" : "var(--c-grid)"} />
              <text x={-10} dy="0.32em" textAnchor="end" className="cars-curves__tick">
                {compactValue(def, tv)}
              </text>
            </g>
          ))}
          <line x1={0} x2={0} y1={0} y2={innerH} stroke="var(--c-border)" />
          {xTicks.map((yr) => (
            <g key={yr} transform={`translate(${x(yr)},${innerH})`}>
              <line y1={0} y2={5} stroke="var(--c-border)" />
              <text y={20} textAnchor="middle" className="cars-curves__tick">
                {t("carsCompare.curves.yearTick", { value: yr })}
              </text>
            </g>
          ))}
          <text
            transform={`translate(${-MARGIN.left + 14},${innerH / 2}) rotate(-90)`}
            textAnchor="middle"
            className="cars-curves__axis"
            data-testid="curves-y-label"
          >
            {def.label} ({def.unit})
          </text>
          <text x={innerW / 2} y={innerH + 36} textAnchor="middle" className="cars-curves__axis">
            {t("carsCompare.curves.axisYears")}
          </text>

          {showBands &&
            series.map((s) => (
              <path
                key={`band-${s.option.result.option_id}`}
                d={areaGen(s.pts) ?? undefined}
                fill={s.color}
                fillOpacity={0.12}
                stroke="none"
                data-testid="curve-band"
              />
            ))}

          <line
            x1={exitX}
            x2={exitX}
            y1={0}
            y2={innerH}
            stroke="var(--c-ink)"
            strokeDasharray="3 3"
            data-testid="exit-marker"
          />
          <text x={exitX} y={-6} textAnchor="middle" className="cars-curves__exit">
            {t("carsCompare.leaveAt", { years: formatYears(exitYears) })}
          </text>

          {series.map((s) => (
            <path
              key={s.option.result.option_id}
              d={lineGen(s.pts) ?? undefined}
              fill="none"
              stroke={s.color}
              strokeWidth={2.5}
              strokeDasharray={modeDash(s.option.option_kind)}
              strokeLinecap="round"
              data-testid="curve-line"
            >
              <title>
                {s.option.result.label} · {MODE_LABELS[s.option.option_kind]}
              </title>
            </path>
          ))}

          {labels.map(({ s, y: ly }) => (
            <g key={`label-${s.option.result.option_id}`} transform={`translate(${innerW + 8},${ly})`}>
              <text dy="-0.1em" className="cars-curves__label" fill={s.color}>
                {s.option.result.make} {s.option.result.model}
              </text>
              <text dy="1.1em" className="cars-curves__sublabel">
                {s.option.result.trim_group} · {MODE_LABELS[s.option.option_kind]}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
