// Market scatter (spec 023 R2): one dot per listing (or per cohort when
// listings are unavailable), selectable axes, colour-by legend, a d3 brush
// for box-select, click / Enter to toggle a (variant, year), tooltip on
// hover and focus. React owns the SVG; d3 supplies scales and the brush.

import { extent } from "d3-array";
import { brush, type BrushSelection } from "d3-brush";
import { scaleLinear } from "d3-scale";
import { select } from "d3-selection";
import { useEffect, useMemo, useRef, useState } from "react";

import { useContainerWidth } from "../hooks/useContainerWidth";
import { formatKm, formatNok } from "../lib/format";
import {
  COLOR_BYS,
  X_AXES,
  Y_AXES,
  colorKey,
  xValue,
  yValue,
  type ColorBy,
  type Dot,
  type XAxis,
  type YAxis,
} from "../lib/market";
import { CAR_COLORS } from "../lib/measures";
import type { SelectionItem } from "../lib/profile";
import { LANG_TAGS } from "../../i18n/core";
import { useT } from "../../i18n/react";

interface Props {
  dots: Dot[];
  xAxis: XAxis;
  yAxis: YAxis;
  colorBy: ColorBy;
  selection: SelectionItem[];
  onToggle: (variantId: string, year: number) => void;
  onBoxSelect: (pairs: [string, number][]) => void;
}

const HEIGHT = 420;
const MARGIN = { top: 16, right: 20, bottom: 44, left: 72 };

function compactY(axis: YAxis, v: number): string {
  if (axis === "price") {
    const kr = v / 100;
    if (Math.abs(kr) >= 1_000_000) return `${(kr / 1_000_000).toFixed(1).replace(".", ",")} M kr`;
    if (Math.abs(kr) >= 1_000) return `${Math.round(kr / 1000)} k kr`;
    return `${Math.round(kr)} kr`;
  }
  if (axis === "accel") return `${v} s`;
  return String(Math.round(v));
}

function compactX(axis: XAxis, v: number): string {
  if (axis === "year") return String(Math.round(v));
  if (axis === "km") return v >= 1000 ? `${Math.round(v / 1000)} k` : String(Math.round(v));
  return String(Math.round(v));
}

export default function MarketScatter({ dots, xAxis, yAxis, colorBy, selection, onToggle, onBoxSelect }: Props) {
  const { t, lang } = useT();
  const lower = (s: string) => s.toLocaleLowerCase(LANG_TAGS[lang]);
  const { ref, width } = useContainerWidth<HTMLDivElement>(820);
  const innerW = Math.max(200, width - MARGIN.left - MARGIN.right);
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const brushRef = useRef<SVGGElement | null>(null);
  const [hover, setHover] = useState<{ dot: Dot; x: number; y: number } | null>(null);

  const plotted = useMemo(
    () =>
      dots
        .map((d) => ({ d, xv: xValue(d, xAxis), yv: yValue(d, yAxis) }))
        .filter((p): p is { d: Dot; xv: number; yv: number } => p.xv !== null && p.yv !== null),
    [dots, xAxis, yAxis],
  );

  const selectedKeys = useMemo(() => {
    const s = new Set<string>();
    for (const it of selection) for (let y = it.year_from; y <= it.year_to; y++) s.add(`${it.variant_id}:${y}`);
    return s;
  }, [selection]);

  const [xMin, xMax] = useMemo(() => {
    if (xAxis === "year") {
      const yrs = plotted.map((p) => p.d.model_year);
      const lo = yrs.length ? Math.min(...yrs) : 2019;
      const hi = yrs.length ? Math.max(...yrs) : 2026;
      return [lo - 0.5, hi + 0.5];
    }
    const [lo, hi] = extent(plotted, (p) => p.xv);
    return [0, (hi ?? 1) * 1.05 || 1, lo].slice(0, 2) as [number, number];
  }, [plotted, xAxis]);

  const yMax = useMemo(() => {
    const [, hi] = extent(plotted, (p) => p.yv);
    return (hi ?? 1) * 1.08 || 1;
  }, [plotted]);

  const x = scaleLinear().domain([xMin, xMax]).range([0, innerW]);
  const y = scaleLinear().domain([0, yMax]).range([innerH, 0]).nice();

  const legend = useMemo(() => {
    const keys = [...new Set(plotted.map((p) => colorKey(p.d, colorBy)))].sort();
    return new Map(keys.map((k, i) => [k, CAR_COLORS[i % CAR_COLORS.length]]));
  }, [plotted, colorBy, lang]);

  // Box-select: d3-brush on a <g>; on end, report the pairs under the box and
  // clear the brush so the chips are the single source of truth.
  const plottedRef = useRef(plotted);
  plottedRef.current = plotted;
  const scalesRef = useRef({ x, y });
  scalesRef.current = { x, y };
  const onBoxRef = useRef(onBoxSelect);
  onBoxRef.current = onBoxSelect;
  useEffect(() => {
    const g = brushRef.current;
    if (!g) return;
    const b = brush<unknown>()
      .extent([
        [0, 0],
        [innerW, innerH],
      ])
      .on("end", (event: { selection: BrushSelection | null; sourceEvent?: unknown }) => {
        if (!event.selection || !event.sourceEvent) return;
        const [[x0, y0], [x1, y1]] = event.selection as [[number, number], [number, number]];
        const { x: sx, y: sy } = scalesRef.current;
        const pairs: [string, number][] = [];
        const seen = new Set<string>();
        for (const p of plottedRef.current) {
          const px = sx(p.xv);
          const py = sy(p.yv);
          if (px >= x0 && px <= x1 && py >= y0 && py <= y1) {
            const k = `${p.d.variant_id}:${p.d.model_year}`;
            if (!seen.has(k)) {
              seen.add(k);
              pairs.push([p.d.variant_id, p.d.model_year]);
            }
          }
        }
        select(g).call(b.move, null);
        if (pairs.length) onBoxRef.current(pairs);
      });
    const sel = select(g);
    sel.call(b);
    sel.selectAll(".overlay").attr("cursor", "crosshair");
    return () => {
      sel.on(".brush", null);
      sel.selectAll("*").remove();
    };
  }, [innerW, innerH]);

  const xDef = X_AXES.find((a) => a.key === xAxis)!;
  const yDef = Y_AXES.find((a) => a.key === yAxis)!;
  const colorDef = COLOR_BYS.find((c) => c.key === colorBy)!;
  const nSelected = plotted.filter((p) => selectedKeys.has(p.d.cohort_id)).length;
  const isCohort = plotted.length > 0 && plotted[0].d.isCohort;
  const ariaLabel = t("carsPlan.scatter.aria", {
    n: plotted.length,
    what: isCohort ? t("carsPlan.scatter.cohortMedians") : t("carsPlan.scatter.listings"),
    y: lower(yDef.label),
    x: lower(xDef.label),
    colour: lower(colorDef.label),
    selected: nSelected,
  });

  const yearTicks = useMemo(() => {
    const lo = Math.ceil(xMin);
    const hi = Math.floor(xMax);
    const out: number[] = [];
    for (let yr = lo; yr <= hi; yr++) out.push(yr);
    return out;
  }, [xMin, xMax]);
  const xTicks = xAxis === "year" ? yearTicks : x.ticks(6);

  return (
    <div className="cars-market__plotwrap">
      <div className="cars-market__legend" aria-label={t("carsPlan.scatter.legend", { name: colorDef.label })}>
        {[...legend].map(([k, c]) => (
          <span key={k} className="cars-legend__item">
            <span aria-hidden="true" className="cars-swatch" style={{ background: c }} />
            {k}
          </span>
        ))}
      </div>
      <div ref={ref} className="cars-market__plot">
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label={ariaLabel}
          className="cars-market__svg"
          onMouseLeave={() => setHover(null)}
        >
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {xAxis === "year" &&
              yearTicks.map((yr) => (
                <line key={`grid-${yr}`} x1={x(yr)} x2={x(yr)} y1={0} y2={innerH} stroke="var(--c-grid)" />
              ))}
            {y.ticks(6).map((tv) => (
              <g key={tv} transform={`translate(0,${y(tv)})`}>
                <line x1={0} x2={innerW} stroke={tv === 0 ? "var(--c-border)" : "var(--c-grid)"} />
                <text x={-10} dy="0.32em" textAnchor="end" className="cars-curves__tick">
                  {compactY(yAxis, tv)}
                </text>
              </g>
            ))}
            <line x1={0} x2={0} y1={0} y2={innerH} stroke="var(--c-border)" />
            {xTicks.map((tv) => (
              <g key={`xt-${tv}`} transform={`translate(${x(tv)},${innerH})`}>
                <line y1={0} y2={5} stroke="var(--c-border)" />
                <text y={20} textAnchor="middle" className="cars-curves__tick">
                  {compactX(xAxis, tv)}
                </text>
              </g>
            ))}
            <text
              transform={`translate(${-MARGIN.left + 14},${innerH / 2}) rotate(-90)`}
              textAnchor="middle"
              className="cars-curves__axis"
            >
              {yDef.label} ({yDef.unit})
            </text>
            <text x={innerW / 2} y={innerH + 38} textAnchor="middle" className="cars-curves__axis">
              {xDef.label}
              {xAxis === "km" ? " (km)" : xAxis === "range" ? " (km WLTP)" : ""}
            </text>

            <g ref={brushRef} className="cars-market__brush" data-testid="market-brush" />

            {plotted.map((p) => {
              const on = selectedKeys.has(p.d.cohort_id);
              const color = legend.get(colorKey(p.d, colorBy)) ?? CAR_COLORS[0];
              const r = p.d.isCohort ? (on ? 8 : 6.5) : on ? 6 : 4.5;
              const name = `${p.d.label} ${p.d.model_year}${p.d.isCohort ? t("carsPlan.scatter.cohortSuffix") : ""}`;
              return (
                <circle
                  key={p.d.key}
                  cx={x(p.xv)}
                  cy={y(p.yv)}
                  r={r}
                  fill={color}
                  fillOpacity={on ? 1 : 0.35}
                  stroke={on ? "var(--c-ink)" : "none"}
                  strokeWidth={on ? 2 : 0}
                  tabIndex={0}
                  role="button"
                  aria-pressed={on}
                  aria-label={`${name}: ${formatNok(p.d.ask_ore)}, ${formatKm(p.d.km)}`}
                  data-testid="market-dot"
                  data-variant={p.d.variant_id}
                  data-year={p.d.model_year}
                  className="cars-market__dot"
                  onClick={() => onToggle(p.d.variant_id, p.d.model_year)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onToggle(p.d.variant_id, p.d.model_year);
                    }
                  }}
                  onMouseEnter={() => setHover({ dot: p.d, x: x(p.xv) + MARGIN.left, y: y(p.yv) + MARGIN.top })}
                  onFocus={() => setHover({ dot: p.d, x: x(p.xv) + MARGIN.left, y: y(p.yv) + MARGIN.top })}
                  onBlur={() => setHover(null)}
                />
              );
            })}
          </g>
        </svg>
        {hover && (
          <div
            className="cars-market__tip"
            role="tooltip"
            style={{ left: Math.min(hover.x + 12, Math.max(0, width - 220)), top: Math.max(0, hover.y - 10) }}
          >
            <strong>{hover.dot.label}</strong>
            <span>
              {hover.dot.model_year}
              {hover.dot.isCohort
                ? t("carsPlan.scatter.tipCohort")
                : hover.dot.seller
                  ? ` · ${t(hover.dot.seller === "dealer" ? "carsPlan.scatter.seller.dealer" : "carsPlan.scatter.seller.private")}`
                  : ""}
            </span>
            <span>
              {formatKm(hover.dot.km)} · {formatNok(hover.dot.ask_ore)}
            </span>
          </div>
        )}
      </div>
      <p className="cars-hint">{t(isCohort ? "carsPlan.scatter.hintCohort" : "carsPlan.scatter.hintListing")}</p>
    </div>
  );
}
