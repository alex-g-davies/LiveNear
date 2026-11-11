// Option detail (spec 022 R11, 024 follow-up): every number on this screen is
// read at one exit point, the same "Mark an exit point" slider the Compare
// curves use (shared through the car state). Tiles, the chart marker, the
// purchase / sale strip and "Where the money goes" all come from the central
// path at that month, so they agree with each other to the krone; the
// simulated P10–P90 range is shown beside them. The inputs table formats
// values in display units and converts overrides back to the engine's units.

import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";

import type { InputView, OptionSummary } from "../api";
import Badge from "../components/Badge";
import ExitChart from "../components/ExitChart";
import MeasureSelect from "../components/MeasureSelect";
import {
  formatDate,
  formatKm,
  formatMonths,
  formatNok,
  formatPerKm,
  formatYears,
  plainSource,
  readableDates,
} from "../lib/format";
import { MODE_LABELS, measureDef } from "../lib/measures";
import { useCarState } from "../state";
import { DRIVE_PATH, drivePath } from "../../lib/productRoutes";

function bestOfKind(options: OptionSummary[], self: OptionSummary, kind: "lease" | "new", measure: keyof OptionSummary["result"]["measures"]) {
  const same = options.filter(
    (o) =>
      o.result.option_id !== self.result.option_id &&
      o.option_kind === kind &&
      o.result.make === self.result.make &&
      o.result.model === self.result.model,
  );
  if (!same.length) return null;
  return same.reduce((a, b) =>
    a.result.measures[measure].expected.p50 <= b.result.measures[measure].expected.p50 ? a : b,
  );
}

/** Money units are øre in the engine; the user types kroner. */
export function toEngineUnits(typed: number, unit: string | null | undefined): number {
  return unit && unit.startsWith("kr") ? Math.round(typed * 100) : typed;
}

function findInput(inputs: InputView[], ...tails: string[]): InputView | null {
  return inputs.find((i) => tails.some((t) => i.id === t || i.id.endsWith(`.${t}`))) ?? null;
}

function isUrl(s: string): boolean {
  return /^https?:\/\/\S+$/.test(s);
}

export default function OptionDetail() {
  const { optionId } = useParams();
  const { state, scenario, setMeasure, setOverride, clearOverride, request, exitMonth, setExitMonth } = useCarState();
  const def = measureDef(state.measure);
  const data = scenario.data;
  const option = data?.options.find((o) => o.result.option_id === optionId) ?? null;
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (!request) {
    return (
      <p className="cars-empty">
        No cars selected yet. <Link to={DRIVE_PATH}>Pick some on Your situation</Link>.
      </p>
    );
  }
  if (!option) {
    return (
      <>
        <Link to={drivePath("/compare")} className="cars-link cars-back">
          Back to all options
        </Link>
        {scenario.error && (
          <div className="status status--error" role="alert">
            Could not compute the scenario: {scenario.error}
          </div>
        )}
        <p className="cars-empty">
          {!data && scenario.loading
            ? "Loading option…"
            : "This option is not in the current results (it may be ruled out by your limits)."}
        </p>
      </>
    );
  }

  const r = option.result;
  const m = r.measures[state.measure];
  const t = exitMonth;
  const years = t / 12;
  const atExit = m.deterministic[t];
  const lo = m.band.p10[t];
  const hi = m.band.p90[t];
  const rowLabels = r.display["36"] ?? [];
  const items = rowLabels.map((d) => ({ key: d.key, label: d.label, ore: r.display_series?.[d.key]?.[t] ?? 0 }));
  const total = items.reduce((s, i) => s + i.ore, 0);
  const maxItem = Math.max(1, ...items.map((i) => Math.abs(i.ore)));
  const perMonthAt = r.measures.per_month.deterministic[t];
  const perKmAt = r.measures.per_km.deterministic[t];
  const bestLease = bestOfKind(data?.options ?? [], option, "lease", state.measure);
  const bestNew = bestOfKind(data?.options ?? [], option, "new", state.measure);
  const isLease = option.option_kind === "lease";

  const priceInput = findInput(r.inputs, "price", "purchase_price");
  const resaleInput = findInput(r.inputs, "resale_path", "resale_retention", "resale_curve");
  const rentInput = findInput(r.inputs, "lease_monthly", "monthly", "lease_rent");
  const purchase = r.purchase_price;
  const sale = r.resale_band?.p50[t] ?? r.resale_p50?.[t] ?? null;
  const saleLo = r.resale_band?.p10[t] ?? null;
  const saleHi = r.resale_band?.p90[t] ?? null;
  const valueLost = r.display_series?.value_lost?.[t] ?? null;
  const sellCost = purchase !== null && sale !== null && valueLost !== null ? valueLost - (purchase - sale) : null;

  const subtitle = [
    isLease ? "Lease, 36 months" : `${MODE_LABELS[option.option_kind]} · model year ${r.model_year}`,
    option.seller_type === "dealer" ? "bought from a dealer" : option.seller_type === "private" ? "bought privately" : null,
    r.km_at[0] > 0 ? `${formatKm(r.km_at[0])} on the clock` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const submitOverride = (e: FormEvent, inp: InputView) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    const n = Number(trimmed.replace(/\s/g, "").replace(",", "."));
    setOverride(inp.id, Number.isFinite(n) ? toEngineUnits(n, inp.unit) : trimmed);
    setEditing(null);
    setDraft("");
  };

  return (
    <>
      <div className="cars-detailhead">
        <Link to={drivePath("/compare")} className="cars-link cars-back">
          Back to all options
        </Link>
        <div className="cars-titlebar">
          <div className="cars-titlebar__text">
            <h1 className="cars-h1">{r.label}</h1>
            <p className="cars-lede">{subtitle}</p>
          </div>
          <div className="cars-titlebar__tools">
            <Badge status={r.status} estimates={r.material_estimate_labels} />
            <MeasureSelect value={state.measure} onChange={setMeasure} />
            {scenario.loading && <span className="cars-hint">updating…</span>}
          </div>
        </div>
        {scenario.error && (
          <div className="status status--error" role="alert">
            Could not compute the scenario: {scenario.error} — showing the last good result.
          </div>
        )}
      </div>

      <div className="cars-tiles">
        <div className="cars-tile cars-tile--accent">
          <span className="cars-hint">
            {def.label} if you leave at {formatYears(years)}
          </span>
          <span className="cars-tile__value" data-testid="tile-at-exit">
            {def.format(atExit)}
          </span>
          <span className="cars-hint">
            Likely {def.format(lo)} to {def.format(hi)}
          </span>
        </div>
        <div className="cars-tile">
          <span className="cars-hint">Expected {def.label.toLowerCase()}</span>
          <span className="cars-tile__value" data-testid="tile-expected">
            {def.format(m.expected.p50)}
          </span>
          <span className="cars-hint">Weighted by your exit odds, as ranked on Compare</span>
        </div>
        <div className="cars-tile">
          <span className="cars-hint">Best and worst exit</span>
          <span className="cars-tile__value" data-testid="tile-best">
            {def.format(m.best.value)}
          </span>
          <span className="cars-hint">
            Best at {formatMonths(m.best.month)} · worst {def.format(m.worst.value)} at {formatMonths(m.worst.month)}
          </span>
        </div>
        <div className="cars-tile">
          <span className="cars-hint">Cash up front</span>
          <span className="cars-tile__value">{formatNok(r.cash_up_front)}</span>
          <span className="cars-hint">{isLease ? "Upfront rent" : "Down payment and fees"}</span>
        </div>
      </div>

      <section className="cars-card cars-card--wide" aria-labelledby="deal">
        <div className="cars-card__head">
          <h2 id="deal" className="cars-h2">
            {isLease ? "What you pay for the lease" : "Buying and selling"}
          </h2>
          <p className="cars-hint">
            {isLease
              ? `Rent to ${formatYears(years)} and what it costs to hand the car back then. Nothing comes back at the end of a lease.`
              : `What you pay now and what the market model expects you to get back if you sell at ${formatYears(years)}.`}
          </p>
        </div>
        {isLease ? (
          <div className="cars-deal">
            <div className="cars-deal__item">
              <span className="cars-hint">Monthly rent</span>
              <span className="cars-deal__value">{rentInput ? rentInput.display_value ?? rentInput.value : "—"}</span>
              <span className="cars-deal__meta">
                {rentInput && <Badge status={rentInput.status} />}
                {rentInput && <span className="cars-hint">{plainSource(rentInput.source)}</span>}
              </span>
            </div>
            <div className="cars-deal__item">
              <span className="cars-hint">Rent paid by {formatYears(years)}</span>
              <span className="cars-deal__value">{formatNok(r.display_series?.lease_payments?.[t] ?? 0)}</span>
              <span className="cars-hint">Including the upfront rent</span>
            </div>
            <div className="cars-deal__item">
              <span className="cars-hint">Cost to hand it back at {formatYears(years)}</span>
              <span className="cars-deal__value">{formatNok(r.display_series?.exit_costs?.[t] ?? 0)}</span>
              <span className="cars-hint">Early-exit charge, excess km and end-of-lease fees</span>
            </div>
          </div>
        ) : (
          <div className="cars-deal">
            <div className="cars-deal__item">
              <span className="cars-hint">Purchase price</span>
              <span className="cars-deal__value" data-testid="deal-purchase">
                {purchase !== null ? formatNok(purchase) : priceInput ? priceInput.display_value ?? priceInput.value : "—"}
              </span>
              <span className="cars-deal__meta">
                {priceInput && <Badge status={priceInput.status} />}
                {priceInput && <span className="cars-hint">{plainSource(priceInput.source)}</span>}
              </span>
            </div>
            <div className="cars-deal__item">
              <span className="cars-hint">Sale price if you leave at {formatYears(years)}</span>
              <span className="cars-deal__value" data-testid="deal-sale">
                {sale !== null ? formatNok(sale) : "—"}
              </span>
              <span className="cars-deal__meta">
                {resaleInput && <Badge status={resaleInput.status} />}
                <span className="cars-hint">
                  {saleLo !== null && saleHi !== null
                    ? `Likely ${formatNok(saleLo)} to ${formatNok(saleHi)}`
                    : plainSource(resaleInput?.source) || "Market model"}
                </span>
              </span>
            </div>
            <div className="cars-deal__item">
              <span className="cars-hint">Value lost by {formatYears(years)}</span>
              <span className="cars-deal__value" data-testid="deal-value-lost">
                {valueLost !== null ? formatNok(valueLost) : "—"}
              </span>
              <span className="cars-hint">
                {sellCost !== null && sellCost !== 0
                  ? `Price minus sale price, plus ${formatNok(sellCost)} to sell`
                  : "Price minus sale price"}
              </span>
            </div>
          </div>
        )}
      </section>

      <div className="cars-layout cars-layout--even">
        <section className="cars-card cars-layout__main" aria-labelledby="exitchart">
          <div className="cars-card__head">
            <h2 id="exitchart" className="cars-h2">
              {def.label} by when you leave
            </h2>
            <p className="cars-hint">Compared with the best lease and best new-car option for the same model.</p>
          </div>
          <ExitChart
            option={option}
            bestLease={bestLease}
            bestNew={bestNew}
            measure={state.measure}
            exitOdds={data?.exit_odds ?? { "12": 0.25, "24": 0.25, "36": 0.25, "48": 0.25 }}
            exitMonth={t}
          />
          <label className="cars-field cars-field--exit">
            <span className="cars-field__label cars-field__label--row">
              <span>Mark an exit point</span>
              <span className="cars-hint">{formatYears(years)}</span>
            </span>
            <input
              type="range"
              min={0.5}
              max={5}
              step={0.25}
              className="cars-slider cars-slider--ink"
              value={years}
              onChange={(e) => setExitMonth(Number(e.target.value) * 12)}
            />
            <span className="cars-hint">The tiles, the figures above and the breakdown all follow this point. Compare uses the same one.</span>
          </label>
        </section>

        <section className="cars-card cars-layout__aside cars-layout__aside--wide" aria-labelledby="money">
          <div className="cars-card__head">
            <h2 id="money" className="cars-h2">
              Where the money goes
            </h2>
            <p className="cars-hint">
              Totals if you leave at {formatYears(years)}. That is {formatNok(perMonthAt)} per month, or{" "}
              {formatPerKm(perKmAt)}.
              {state.measure === "npc" && " Net present cost discounts later payments, so it sits below this total."}
            </p>
          </div>
          {items.map((it) => (
            <div key={it.key} className="cars-bar">
              <span>{it.label}</span>
              <div className="cars-bar__track" aria-hidden="true">
                <div
                  className={`cars-bar__fill ${it.ore < 0 ? "cars-bar__fill--neg" : ""}`}
                  style={{ width: `${(Math.abs(it.ore) / maxItem) * 100}%` }}
                />
              </div>
              <span className="cars-bar__value">{formatNok(it.ore)}</span>
            </div>
          ))}
          <div className="cars-bar cars-bar--total">
            <span>Total</span>
            <span />
            <span className="cars-bar__value" data-testid="money-total">
              {formatNok(total)}
            </span>
          </div>
        </section>
      </div>

      <section className="cars-card cars-card--flush" aria-labelledby="inputs">
        <div className="cars-card__bar cars-card__bar--plain">
          <h2 id="inputs" className="cars-h2">
            Inputs and sources
          </h2>
          <span className="cars-hint">Replace any estimate with your own number</span>
        </div>
        <div className="cars-tablewrap">
          <table className="cars-table cars-table--inputs">
            <thead>
              <tr>
                <th scope="col">Input</th>
                <th scope="col">Value</th>
                <th scope="col">Source</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {r.inputs.map((inp) => {
                const overridden = inp.id in state.overrides;
                const label = inp.label;
                const range = inp.display_range ?? inp.range;
                return (
                  <tr key={inp.id} data-testid={`input-${inp.id}`}>
                    <td className="cars-strong">
                      {label}
                      {inp.material && <span className="cars-hint"> · key input</span>}
                    </td>
                    <td>
                      {readableDates(String(inp.display_value ?? inp.value))}
                      {range && (
                        <div className="cars-hint">
                          Range {range[0]} to {range[1]}
                        </div>
                      )}
                    </td>
                    <td className="cars-hint">
                      {isUrl(inp.source) ? (
                        <a href={inp.source} target="_blank" rel="noreferrer" className="cars-link cars-link--wrap">
                          {inp.source.replace(/^https?:\/\/(www\.)?/, "")}
                        </a>
                      ) : (
                        plainSource(inp.source)
                      )}
                      {inp.basis && <div className="cars-inputs__basis">Basis: {plainSource(inp.basis)}</div>}
                    </td>
                    <td>
                      <Badge status={inp.status} />
                      <div className="cars-hint cars-nowrap">{formatDate(inp.as_of)}</div>
                    </td>
                    <td className="cars-table__action">
                      {editing === inp.id ? (
                        <form className="cars-override" onSubmit={(e) => submitOverride(e, inp)}>
                          <label className="cars-field cars-field--inline">
                            <span className="sr-only">New value for {label}</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              step="any"
                              className="cars-input cars-input--sm"
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              autoFocus
                            />
                            {inp.unit && <span className="cars-hint cars-override__unit">{inp.unit}</span>}
                          </label>
                          <button type="submit" className="cars-btn cars-btn--sm cars-btn--primary">
                            Apply
                          </button>
                          <button
                            type="button"
                            className="cars-btn cars-btn--sm"
                            onClick={() => {
                              setEditing(null);
                              setDraft("");
                            }}
                          >
                            Cancel
                          </button>
                        </form>
                      ) : overridden ? (
                        <button
                          type="button"
                          className="cars-btn cars-btn--sm"
                          onClick={() => clearOverride(inp.id)}
                          aria-label={`Clear override for ${label}`}
                        >
                          Clear
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="cars-btn cars-btn--sm"
                          onClick={() => {
                            setEditing(inp.id);
                            setDraft("");
                          }}
                          aria-label={`Override ${label}`}
                        >
                          Override
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
