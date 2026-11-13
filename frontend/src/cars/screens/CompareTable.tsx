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
import { RecommendStrip } from "../components/Recommendations";
import EnglishText from "../../components/EnglishText";
import { LANG_TAGS, hasKey, tDynamic } from "../../i18n/core";
import { monthsText } from "../../i18n/dates";
import { useT } from "../../i18n/react";
import { formatMonths, formatNokSigned } from "../lib/format";
import { MODES, type Mode } from "../lib/profile";
import { energyName } from "../lib/market";
import { MODE_FILTER_LABELS, MODE_LABELS, estimateLabels, measureDef, measureInSentence } from "../lib/measures";
import { useCarState } from "../state";
import { useColorOf } from "../lib/colors";
import { DRIVE_PATH, drivePath } from "../../lib/productRoutes";

/** Sensitivity drivers are a fixed set (engine/run.py); unknown ones keep
 *  the backend's English label. */
function sensLabel(driver: string, fallback: string): string {
  const key = `carsCompare.sens.${driver}`;
  return hasKey(key) ? tDynamic(key) : fallback;
}

export default function CompareTable() {
  const { t, lang } = useT();
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
      <RecommendStrip />
      <div className="cars-layout">
        <section className="cars-card cars-card--flush cars-layout__main" aria-labelledby="ranked">
          <div className="cars-card__bar">
            <div className="cars-card__bar-left">
              <h2 id="ranked" className="cars-h2">
                {t("carsCompare.table.rankedBy")}
              </h2>
              <MeasureSelect value={state.measure} onChange={setMeasure} />
            </div>
            <div role="group" aria-label={t("carsCompare.table.filterGroup")} className="cars-filters">
              <button
                type="button"
                className="cars-filter"
                aria-pressed={filter === "all"}
                onClick={() => setFilter("all")}
              >
                {t("carsCompare.table.all")}
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
              {t("carsCompare.noCars")} <Link to={DRIVE_PATH}>{t("carsCompare.pickSome")}</Link>.
            </p>
          )}
          {request && !data && scenario.loading && <p className="cars-empty">{t("carsCompare.table.computing")}</p>}
          {data && rows.length === 0 && <p className="cars-empty">{t("carsCompare.table.noMatch")}</p>}

          {data && rows.length > 0 && (
            <div className="cars-tablewrap">
              <table className="cars-table">
                <thead>
                  <tr>
                    <th scope="col" className="cars-table__rank">
                      #
                    </th>
                    <th scope="col">{t("carsCompare.table.colCar")}</th>
                    <th scope="col" className="cars-table__num">
                      {t("carsCompare.table.colExpected", { unit: def.unit })}
                    </th>
                    <th scope="col" className="cars-table__range">
                      {t("carsCompare.table.colRange")}
                    </th>
                    <th scope="col" className="cars-table__num">
                      {t("carsCompare.table.colFun")}
                    </th>
                    <th scope="col">{t("carsCompare.table.colData")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o, i) => {
                    const r = o.result;
                    const m = r.measures[state.measure];
                    const seller =
                      o.seller_type === "dealer"
                        ? ` · ${t("carsCompare.seller.dealer")}`
                        : o.seller_type === "private"
                          ? ` · ${t("carsCompare.seller.private")}`
                          : "";
                    return (
                      <tr key={r.option_id} data-testid="option-row">
                        <td className="cars-table__rank">{i + 1}</td>
                        <td>
                          <Link to={drivePath(`/option/${encodeURIComponent(r.option_id)}`)} className="cars-table__car">
                            <span
                              aria-hidden="true"
                              className="cars-swatch"
                              style={{ background: colorOf(o.variant_id) }}
                            />
                            {r.label}
                          </Link>
                          <div className="cars-hint">
                            {MODE_LABELS[o.option_kind]}
                            {o.option_kind === "lease" ? `, ${monthsText(36)}` : ` · ${r.model_year}`}
                            {` · ${energyName(r.energy_type, r.fuel)}`}
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
                            label={t("carsCompare.table.rangeLabel", {
                              best: def.format(m.best.value),
                              bestAt: formatMonths(m.best.month),
                              worst: def.format(m.worst.value),
                              worstAt: formatMonths(m.worst.month),
                              expected: def.format(m.expected.p50),
                            })}
                          />
                        </td>
                        <td className="cars-table__num cars-hint">{r.fun_score} / 10</td>
                        <td>
                          <Badge status={r.status} estimates={estimateLabels(r)} />
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
                  <span className="cars-strong">{t("carsCompare.table.ruledOut", { count: data.ruled_out.length })}</span>
                  <ul className="cars-list">
                    {data.ruled_out.map((r) => (
                      <li key={r.option_id}>
                        {r.label}: <EnglishText>{r.reasons.join("; ")}</EnglishText>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {data.skipped.length > 0 && (
                <>
                  <span className="cars-strong">{t("carsCompare.table.notShown", { count: data.skipped.length })}</span>
                  <ul className="cars-list">
                    {data.skipped.map((s, i) => (
                      <li key={i}>
                        <EnglishText>{s}</EnglishText>
                      </li>
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
                {t("carsCompare.table.movesTitle")}
              </h2>
              <p className="cars-hint">
                {t("carsCompare.table.movesHint", { measure: measureInSentence(def) })}
                {topLabel
                  ? ` ${t("carsCompare.table.topOption", {
                      label: topLabel.label,
                      mode: MODE_LABELS[topLabel.mode].toLocaleLowerCase(LANG_TAGS[lang]),
                    })}`
                  : ""}
              </p>
            </div>
            {sensRows.length === 0 && <p className="cars-hint">{t("carsCompare.table.noSensitivity")}</p>}
            {sensRows.map((s) => {
              const lo = Math.min(s.low, s.high);
              const hi = Math.max(s.low, s.high);
              const left = 50 + (lo / sensMax) * 50;
              const width = ((hi - lo) / sensMax) * 50;
              const label = sensLabel(s.driver, s.label);
              // The per-row note is English prose (R7). In English it is the
              // row tooltip as before; elsewhere it sits on the bar, marked
              // lang="en", so the translated label is not marked English.
              const english = lang === "en";
              return (
                <div key={s.driver} className="cars-sens" title={english ? s.note : undefined}>
                  <span className="cars-sens__label">
                    {label}
                    <span className="cars-hint">
                      {" "}
                      {formatNokSigned(lo)} … {formatNokSigned(hi)}
                    </span>
                  </span>
                  <div
                    className="cars-sens__track"
                    role="img"
                    aria-label={t("carsCompare.table.sensRange", { label, lo: formatNokSigned(lo), hi: formatNokSigned(hi) })}
                  >
                    <div className="cars-sens__zero" />
                    <div
                      className="cars-sens__bar"
                      style={{ left: `${left}%`, width: `${width}%` }}
                      {...(english || !s.note ? {} : { title: `${s.note} ${t("common.englishTag")}`, lang: "en" })}
                    />
                  </div>
                </div>
              );
            })}
            {sensNote && (
              <p className="cars-hint">
                <EnglishText>{sensNote}</EnglishText>
              </p>
            )}
          </section>

          <section className="cars-card" aria-labelledby="read">
            <h2 id="read" className="cars-h3">
              {t("carsCompare.table.readTitle")}
            </h2>
            <div className="cars-read">
              <RangeBar lo={0.15} mid={0.35} hi={0.8} label={t("carsCompare.table.readExample")} />
              <span>{t("carsCompare.table.readBar")}</span>
            </div>
            <div className="cars-read">
              <Badge status="live" />
              <span>{t("carsCompare.badge.liveTitle")}</span>
            </div>
            <div className="cars-read">
              <Badge status="estimate" />
              <span>{t("carsCompare.table.readEstimate")}</span>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
