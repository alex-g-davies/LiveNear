// Compare — table (spec 022 R11): one row per car × way to get it, ranked by
// the expected value of the selected measure, with the best-to-worst range
// bar, fun score and Live/Estimate badge; ruled-out options and skipped
// notes below; sensitivity of the top option in the right rail.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import Badge from "../components/Badge";
import CompareHeader from "../components/CompareHeader";
import MeasureSelect from "../components/MeasureSelect";
import RangeBar from "../components/RangeBar";
import { formatMonths, formatNokSigned } from "../lib/format";
import { MODES, type Mode } from "../lib/profile";
import { MODE_FILTER_LABELS, MODE_LABELS, measureDef } from "../lib/measures";
import { useCarState } from "../state";
import { useColorOf } from "../lib/colors";

export default function CompareTable() {
  const { state, setMeasure, scenario, request } = useCarState();
  const [filter, setFilter] = useState<Mode | "all">("all");
  const def = measureDef(state.measure);
  const data = scenario.data;
  const colorOf = useColorOf(state.selection, data);

  const rows = useMemo(() => {
    if (!data) return [];
    const list = data.options.filter((o) => filter === "all" || o.option_kind === filter);
    return list
      .slice()
      .sort(
        (a, b) =>
          a.result.measures[state.measure].expected.p50 - b.result.measures[state.measure].expected.p50,
      );
  }, [data, filter, state.measure]);
  const scaleMax = Math.max(1, ...rows.map((r) => r.result.measures[state.measure].worst.value));

  const sensRows = (data?.sensitivity ?? []).filter((s) => s.driver !== "swap");
  const sensNote = (data?.sensitivity ?? []).find((s) => s.driver === "swap")?.note;
  const sensMax = Math.max(1, ...sensRows.flatMap((s) => [Math.abs(s.low), Math.abs(s.high)]));
  const topLabel = data?.options.find((o) => o.result.option_id === data.sensitivity_option_id)?.result;

  return (
    <>
      <CompareHeader view="table" />
      <div className="cars-layout">
        <section className="cars-card cars-card--flush cars-layout__main" aria-labelledby="ranked">
          <div className="cars-card__bar">
            <div className="cars-card__bar-left">
              <h2 id="ranked" className="cars-h2">
                Ranked by
              </h2>
              <MeasureSelect value={state.measure} onChange={setMeasure} />
            </div>
            <div role="group" aria-label="Filter by way to get a car" className="cars-filters">
              <button
                type="button"
                className="cars-filter"
                aria-pressed={filter === "all"}
                onClick={() => setFilter("all")}
              >
                All
              </button>
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  className="cars-filter"
                  aria-pressed={filter === m}
                  onClick={() => setFilter(m)}
                >
                  {MODE_FILTER_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          {!request && (
            <p className="cars-empty">
              No cars selected yet. <Link to="/cars">Pick some on Your situation</Link>.
            </p>
          )}
          {request && !data && scenario.loading && <p className="cars-empty">Computing options…</p>}
          {data && rows.length === 0 && <p className="cars-empty">No options match this filter.</p>}

          {data && rows.length > 0 && (
            <div className="cars-tablewrap">
              <table className="cars-table">
                <thead>
                  <tr>
                    <th scope="col" className="cars-table__rank">
                      #
                    </th>
                    <th scope="col">Car and way to get it</th>
                    <th scope="col" className="cars-table__num">
                      Expected ({def.unit})
                    </th>
                    <th scope="col" className="cars-table__range">
                      Best to worst exit
                    </th>
                    <th scope="col" className="cars-table__num">
                      Fun score
                    </th>
                    <th scope="col">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o, i) => {
                    const r = o.result;
                    const m = r.measures[state.measure];
                    const seller =
                      o.seller_type === "dealer" ? " · dealer" : o.seller_type === "private" ? " · private" : "";
                    return (
                      <tr key={r.option_id} data-testid="option-row">
                        <td className="cars-table__rank">{i + 1}</td>
                        <td>
                          <Link to={`/cars/option/${encodeURIComponent(r.option_id)}`} className="cars-table__car">
                            <span
                              aria-hidden="true"
                              className="cars-swatch"
                              style={{ background: colorOf(o.variant_id) }}
                            />
                            {r.label}
                          </Link>
                          <div className="cars-hint">
                            {MODE_LABELS[o.option_kind]}
                            {o.option_kind === "lease" ? ", 36 months" : ` · ${r.model_year}`}
                            {seller}
                          </div>
                        </td>
                        <td className="cars-table__num cars-table__expected" data-testid="expected">
                          {def.format(m.expected.p50)}
                        </td>
                        <td className="cars-table__range">
                          <RangeBar
                            lo={m.best.value / scaleMax}
                            mid={m.expected.p50 / scaleMax}
                            hi={m.worst.value / scaleMax}
                            label={`Best ${def.format(m.best.value)} at ${formatMonths(m.best.month)}, worst ${def.format(m.worst.value)} at ${formatMonths(m.worst.month)}, expected ${def.format(m.expected.p50)}`}
                          />
                        </td>
                        <td className="cars-table__num cars-hint">{r.fun_score} / 10</td>
                        <td>
                          <Badge status={r.status} estimates={r.material_estimates} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {data && (data.ruled_out.length > 0 || data.skipped.length > 0) && (
            <div className="cars-card__foot">
              {data.ruled_out.length > 0 && (
                <>
                  <span className="cars-strong">Ruled out by your limits ({data.ruled_out.length})</span>
                  <ul className="cars-list">
                    {data.ruled_out.map((r) => (
                      <li key={r.option_id}>
                        {r.label}: {r.reasons.join("; ")}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {data.skipped.length > 0 && (
                <>
                  <span className="cars-strong">Not shown ({data.skipped.length})</span>
                  <ul className="cars-list">
                    {data.skipped.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </section>

        <aside className="cars-layout__aside">
          <section className="cars-card" aria-labelledby="moves">
            <div className="cars-card__head">
              <h2 id="moves" className="cars-h3">
                What moves the top result
              </h2>
              <p className="cars-hint">
                Change in expected {def.label.toLowerCase()} if each input moves across its likely range.
                {topLabel ? ` Top option: ${topLabel.label}, ${MODE_LABELS[topLabel.mode].toLowerCase()}.` : ""}
              </p>
            </div>
            {sensRows.length === 0 && <p className="cars-hint">No sensitivity yet.</p>}
            {sensRows.map((s) => {
              const lo = Math.min(s.low, s.high);
              const hi = Math.max(s.low, s.high);
              const left = 50 + (lo / sensMax) * 50;
              const width = ((hi - lo) / sensMax) * 50;
              return (
                <div key={s.driver} className="cars-sens" title={s.note}>
                  <span className="cars-sens__label">
                    {s.label}
                    <span className="cars-hint">
                      {" "}
                      {formatNokSigned(lo)} … {formatNokSigned(hi)}
                    </span>
                  </span>
                  <div
                    className="cars-sens__track"
                    role="img"
                    aria-label={`${s.label}: from ${formatNokSigned(lo)} to ${formatNokSigned(hi)}`}
                  >
                    <div className="cars-sens__zero" />
                    <div className="cars-sens__bar" style={{ left: `${left}%`, width: `${width}%` }} />
                  </div>
                </div>
              );
            })}
            {sensNote && <p className="cars-hint">{sensNote}</p>}
          </section>

          <section className="cars-card" aria-labelledby="read">
            <h2 id="read" className="cars-h3">
              How to read this
            </h2>
            <div className="cars-read">
              <RangeBar lo={0.15} mid={0.35} hi={0.8} label="Example range bar" />
              <span>Bar spans your best and worst exit year. The mark is the expected cost.</span>
            </div>
            <div className="cars-read">
              <Badge status="live" />
              <span>Every key input pulled from a dated source.</span>
            </div>
            <div className="cars-read">
              <Badge status="estimate" />
              <span>At least one key input is modelled or a default. Hover the badge to see which.</span>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
