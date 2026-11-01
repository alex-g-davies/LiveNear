// Option detail (spec 022 R11): tiles, cost-by-exit chart against the best
// lease / best new for the same model, "where the money goes" bars at the
// most likely exit, and the inputs table with inline Override.

import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";

import type { ExitMonthKey, OptionSummary } from "../api";
import Badge, { humanizeId } from "../components/Badge";
import ExitChart from "../components/ExitChart";
import MeasureSelect from "../components/MeasureSelect";
import { formatDate, formatKm, formatMonths, formatNok } from "../lib/format";
import { MODE_LABELS, measureDef } from "../lib/measures";
import { mostLikelyExit } from "../lib/profile";
import { useCarState } from "../state";

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

export default function OptionDetail() {
  const { optionId } = useParams();
  const { state, scenario, setMeasure, setOverride, clearOverride, request } = useCarState();
  const def = measureDef(state.measure);
  const data = scenario.data;
  const option = data?.options.find((o) => o.result.option_id === optionId) ?? null;
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (!request) {
    return (
      <p className="cars-empty">
        No cars selected yet. <Link to="/cars">Pick some on Your situation</Link>.
      </p>
    );
  }
  if (!option) {
    return (
      <>
        <Link to="/cars/compare" className="cars-link cars-back">
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
  const exitKey = mostLikelyExit(state.profile.exit_odds);
  const monthKey = exitKey.slice(1) as ExitMonthKey;
  const items = r.display[monthKey] ?? [];
  const total = items.reduce((s, i) => s + i.ore, 0);
  const maxItem = Math.max(1, ...items.map((i) => Math.abs(i.ore)));
  const months = Number(monthKey);
  const bestLease = bestOfKind(data?.options ?? [], option, "lease", state.measure);
  const bestNew = bestOfKind(data?.options ?? [], option, "new", state.measure);

  const subtitle = [
    option.option_kind === "lease" ? "Lease, 36 months" : `${MODE_LABELS[option.option_kind]} · model year ${r.model_year}`,
    option.seller_type === "dealer" ? "bought from a dealer" : option.seller_type === "private" ? "bought privately" : null,
    r.km_at[0] > 0 ? `${formatKm(r.km_at[0])} on the clock` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const submitOverride = (e: FormEvent, id: string) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    const n = Number(trimmed.replace(/\s/g, "").replace(",", "."));
    setOverride(id, Number.isFinite(n) ? n : trimmed);
    setEditing(null);
    setDraft("");
  };

  return (
    <>
      <div className="cars-detailhead">
        <Link to="/cars/compare" className="cars-link cars-back">
          Back to all options
        </Link>
        <div className="cars-titlebar">
          <div className="cars-titlebar__text">
            <h1 className="cars-h1">{r.label}</h1>
            <p className="cars-lede">{subtitle}</p>
          </div>
          <div className="cars-titlebar__tools">
            <Badge status={r.status} estimates={r.material_estimates} />
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
        <div className="cars-tile">
          <span className="cars-hint">Expected {def.label.toLowerCase()}</span>
          <span className="cars-tile__value" data-testid="tile-expected">
            {def.format(m.expected.p50)}
          </span>
          <span className="cars-hint">Weighted by your exit odds</span>
        </div>
        <div className="cars-tile">
          <span className="cars-hint">Best exit</span>
          <span className="cars-tile__value">{def.format(m.best.value)}</span>
          <span className="cars-hint">If you leave at {formatMonths(m.best.month)}</span>
        </div>
        <div className="cars-tile">
          <span className="cars-hint">Worst exit</span>
          <span className="cars-tile__value">{def.format(m.worst.value)}</span>
          <span className="cars-hint">If you leave at {formatMonths(m.worst.month)}</span>
        </div>
        <div className="cars-tile">
          <span className="cars-hint">Cash up front</span>
          <span className="cars-tile__value">{formatNok(r.cash_up_front)}</span>
          <span className="cars-hint">{option.option_kind === "lease" ? "Upfront rent" : "Down payment and fees"}</span>
        </div>
      </div>

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
          />
        </section>

        <section className="cars-card cars-layout__aside cars-layout__aside--wide" aria-labelledby="money">
          <div className="cars-card__head">
            <h2 id="money" className="cars-h2">
              Where the money goes
            </h2>
            <p className="cars-hint">
              Totals at your most likely exit ({formatMonths(months)}). That is {formatNok(total / months)} per month.
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
            <span className="cars-bar__value">{formatNok(total)}</span>
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
                <th scope="col">As of</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {r.inputs.map((inp) => {
                const overridden = inp.id in state.overrides;
                const label = humanizeId(inp.id);
                return (
                  <tr key={inp.id} data-testid={`input-${inp.id}`}>
                    <td className="cars-strong">
                      {label}
                      {inp.material && <span className="cars-hint"> · key input</span>}
                    </td>
                    <td className="cars-nowrap">
                      {inp.value}
                      {inp.range && <div className="cars-hint">Range {inp.range[0]} to {inp.range[1]}</div>}
                    </td>
                    <td className="cars-hint" title={inp.basis ?? undefined}>
                      {inp.source}
                      {inp.basis && <div>Basis: {inp.basis}</div>}
                    </td>
                    <td className="cars-hint cars-nowrap">{formatDate(inp.as_of)}</td>
                    <td>
                      <Badge status={inp.status} />
                    </td>
                    <td className="cars-table__action">
                      {editing === inp.id ? (
                        <form className="cars-override" onSubmit={(e) => submitOverride(e, inp.id)}>
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
