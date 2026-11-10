// Compare — curves (spec 022 R11): what-if rail, cost curves chart, exit
// marker slider and the ranking at that exit. Slider changes go out as
// `what_if` on the request without touching the saved profile; Save folds
// them in; Reset clears them.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import CompareHeader from "../components/CompareHeader";
import CurvesChart from "../components/CurvesChart";
import MeasureSelect from "../components/MeasureSelect";
import RangeBar from "../components/RangeBar";
import { useColorOf } from "../lib/colors";
import { formatKm, formatPct, formatYears } from "../lib/format";
import { MODE_LABELS, measureDef, modeBorderStyle } from "../lib/measures";
import type { WhatIf } from "../lib/profile";
import { useCarState } from "../state";
import { DRIVE_PATH, drivePath } from "../../lib/productRoutes";

export const DEFAULT_LOAN_RATE_PCT = 6.5;

export default function CompareCurves() {
  const { state, setMeasure, setWhatIf, saveWhatIf, scenario, request, exitMonth, setExitMonth } = useCarState();
  const { profile, whatIf, overrides } = state;
  const def = measureDef(state.measure);
  const data = scenario.data;
  const colorOf = useColorOf(state.selection, data);
  const [showBands, setShowBands] = useState(true);
  const exitYears = exitMonth / 12;

  const savedRate = typeof overrides.loan_rate === "number" ? overrides.loan_rate : DEFAULT_LOAN_RATE_PCT;
  const savedDrift =
    typeof overrides.used_price_drift_pct === "number" ? overrides.used_price_drift_pct : 0;
  const ret = whatIf?.return_on_cash_pct ?? profile.return_on_cash_pct;
  const rate = whatIf?.loan_rate_pct ?? savedRate;
  const km = whatIf?.km_per_year ?? profile.km_per_year;
  const drift = whatIf?.used_price_drift_pct ?? savedDrift;
  const pay = whatIf?.pay_mode ?? (profile.pay_mode === "cash" ? "cash" : "loan");

  const update = (patch: WhatIf) => setWhatIf({ ...(whatIf ?? {}), ...patch });

  const ranking = useMemo(() => {
    if (!data) return [];
    const rows = data.options
      .map((o) => {
        const b = o.result.measures[state.measure].band;
        return { o, p10: b.p10[exitMonth], p50: b.p50[exitMonth], p90: b.p90[exitMonth] };
      })
      .filter((r) => Number.isFinite(r.p50))
      .sort((a, b) => a.p50 - b.p50);
    const maxHi = Math.max(1, ...rows.map((r) => r.p90));
    return rows.map((r) => ({ ...r, maxHi }));
  }, [data, state.measure, exitMonth]);

  const driftLabel = drift < -2 ? "Falling faster" : drift > 1 ? "Holding up" : "As expected";

  return (
    <>
      <CompareHeader view="curves" />
      <div className="cars-layout cars-layout--rail-left">
        <aside className="cars-card cars-layout__aside" aria-label="What-if controls">
          <div className="cars-card__head">
            <h2 className="cars-h3">What if</h2>
            <p className="cars-hint">Changes here only affect this view until you save them.</p>
          </div>
          <fieldset className="cars-fieldset">
            <legend className="cars-legend-label">If buying, pay with</legend>
            <div className="cars-inline">
              <label className="cars-check">
                <input type="radio" name="whatif-pay" checked={pay === "loan"} onChange={() => update({ pay_mode: "loan" })} />{" "}
                Loan
              </label>
              <label className="cars-check">
                <input type="radio" name="whatif-pay" checked={pay === "cash"} onChange={() => update({ pay_mode: "cash" })} />{" "}
                Cash
              </label>
            </div>
          </fieldset>
          <label className="cars-field">
            <span className="cars-field__label cars-field__label--row">
              <span>Return your cash earns</span>
              <span className="cars-hint">{formatPct(ret, 1)}</span>
            </span>
            <input
              type="range"
              min={0}
              max={10}
              step={0.5}
              className="cars-slider"
              value={ret}
              onChange={(e) => update({ return_on_cash_pct: Number(e.target.value) })}
            />
          </label>
          <label className="cars-field">
            <span className="cars-field__label cars-field__label--row">
              <span>Loan rate</span>
              <span className="cars-hint">{formatPct(rate, 2)}</span>
            </span>
            <input
              type="range"
              min={2}
              max={10}
              step={0.25}
              className="cars-slider"
              value={rate}
              onChange={(e) => update({ loan_rate_pct: Number(e.target.value) })}
            />
          </label>
          <label className="cars-field">
            <span className="cars-field__label cars-field__label--row">
              <span>Km per year</span>
              <span className="cars-hint">{formatKm(km)}</span>
            </span>
            <input
              type="range"
              min={5000}
              max={30000}
              step={1000}
              className="cars-slider"
              value={km}
              onChange={(e) => update({ km_per_year: Number(e.target.value) })}
            />
          </label>
          <label className="cars-field">
            <span className="cars-field__label cars-field__label--row">
              <span>Used-car prices</span>
              <span className="cars-hint">
                {driftLabel} ({drift > 0 ? "+" : ""}
                {formatPct(drift, 1)})
              </span>
            </span>
            <input
              type="range"
              min={-10}
              max={5}
              step={0.5}
              className="cars-slider"
              value={drift}
              onChange={(e) => update({ used_price_drift_pct: Number(e.target.value) })}
            />
            <span className="cars-slider__ends">
              <span>Falling faster</span>
              <span>Holding up</span>
            </span>
          </label>
          <label className="cars-check cars-check--top">
            <input type="checkbox" checked={showBands} onChange={(e) => setShowBands(e.target.checked)} /> Show
            uncertainty bands
          </label>
          <div className="cars-inline">
            <button type="button" className="cars-btn" onClick={() => setWhatIf(null)} disabled={!whatIf}>
              Reset
            </button>
            <button type="button" className="cars-btn cars-btn--outline" onClick={saveWhatIf} disabled={!whatIf}>
              Save as my assumptions
            </button>
          </div>
        </aside>

        <section className="cars-card cars-layout__main" aria-labelledby="curves">
          <div className="cars-card__bar cars-card__bar--plain">
            <div className="cars-card__bar-left">
              <MeasureSelect value={state.measure} onChange={setMeasure} />
              <h2 id="curves" className="cars-h2">
                by years of ownership
              </h2>
            </div>
            <div className="cars-legend">
              <span className="cars-legend__item">Colour = car</span>
              <span className="cars-legend__item">
                <span aria-hidden="true" className="cars-legend__swatch" style={{ borderTopStyle: "solid" }} />
                Used
              </span>
              <span className="cars-legend__item">
                <span aria-hidden="true" className="cars-legend__swatch" style={{ borderTopStyle: "dashed" }} />
                Lease
              </span>
              <span className="cars-legend__item">
                <span aria-hidden="true" className="cars-legend__swatch" style={{ borderTopStyle: "dotted" }} />
                New
              </span>
            </div>
          </div>

          {!request && (
            <p className="cars-empty">
              No cars selected yet. <Link to={DRIVE_PATH}>Pick some on Your situation</Link>.
            </p>
          )}
          {request && !data && scenario.loading && <p className="cars-empty">Computing curves…</p>}
          {data && data.options.length > 0 && (
            <CurvesChart
              options={data.options}
              measure={state.measure}
              showBands={showBands}
              exitMonth={exitMonth}
              colorOf={colorOf}
            />
          )}
          {data && data.options.length === 0 && <p className="cars-empty">No options to draw.</p>}

          <label className="cars-field cars-field--exit">
            <span className="cars-field__label cars-field__label--row">
              <span>Mark an exit point</span>
              <span className="cars-hint">{formatYears(exitYears)}</span>
            </span>
            <input
              type="range"
              min={0.5}
              max={5}
              step={0.25}
              className="cars-slider cars-slider--ink"
              value={exitYears}
              onChange={(e) => setExitMonth(Number(e.target.value) * 12)}
            />
          </label>

          {ranking.length > 0 && (
            <div className="cars-rankat">
              <span className="cars-strong">Ranking if you leave at {formatYears(exitYears)}</span>
              <ol className="cars-rankat__list">
                {ranking.map((r, i) => {
                  const color = colorOf(r.o.variant_id);
                  return (
                    <li key={r.o.result.option_id} className="cars-rankat__row">
                      <span className="cars-hint">{i + 1}</span>
                      <span className="cars-rankat__name">
                        <span
                          aria-hidden="true"
                          className="cars-legend__swatch"
                          style={{ borderTopStyle: modeBorderStyle(r.o.option_kind), borderTopColor: color }}
                        />
                        <span className="cars-rankat__text">
                          <span className="cars-strong">{r.o.result.label}</span>
                          <span className="cars-hint">
                            {MODE_LABELS[r.o.option_kind]} · {def.format(r.p50)}
                          </span>
                        </span>
                      </span>
                      <RangeBar
                        lo={r.p10 / r.maxHi}
                        mid={r.p50 / r.maxHi}
                        hi={r.p90 / r.maxHi}
                        color={color}
                        label={`P10 ${def.format(r.p10)}, P50 ${def.format(r.p50)}, P90 ${def.format(r.p90)}`}
                      />
                      <Link to={drivePath(`/option/${encodeURIComponent(r.o.result.option_id)}`)} className="cars-link">
                        Detail
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
