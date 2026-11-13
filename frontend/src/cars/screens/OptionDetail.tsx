// Option detail (spec 022 R11, 024 follow-up): every number on this screen is
// read at one exit point, the same "Mark an exit point" slider the Compare
// curves use (shared through the car state). Tiles, the chart marker, the
// purchase / sale strip and "Where the money goes" all come from the central
// path at that month, so they agree with each other to the krone; the
// simulated P10–P90 range is shown beside them. The inputs table formats
// values in display units and converts overrides back to the engine's units.

import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";

import EnglishText from "../../components/EnglishText";
import { displayLabel, inputLabel } from "../../i18n/backendLabels";
import { t as tCore } from "../../i18n/core";
import { monthsText } from "../../i18n/dates";
import { useT } from "../../i18n/react";
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
  sourceParts,
} from "../lib/format";
import { energyName } from "../lib/market";
import { MODE_LABELS, estimateLabels, measureDef, measureInSentence } from "../lib/measures";
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

const UNIT_RE = /\/(year|month|day|passage)\b/g;

/** "kr/year" -> "kr/år" / "kr/yıl"; identical in English. */
function localUnits(text: string): string {
  return text.replace(UNIT_RE, (_, unit: "year" | "month" | "day" | "passage") => `/${tUnit(unit)}`);
}

function tUnit(unit: "year" | "month" | "day" | "passage"): string {
  return tCore(`carsCompare.unit.${unit}`);
}

/** True if a backend display value has words beyond its units. */
function hasWords(text: string): boolean {
  return /[A-Za-z]{2,}/.test(text.replace(/kWh|Wh|kr|km|øre/g, "").replace(UNIT_RE, ""));
}

/** A backend display value: numbers and units in the site language; text
 *  values (rule tables, cycles) are English prose (028 R7). */
function ValueText({ text }: { text: string }) {
  const { lang } = useT();
  if (lang === "en") return <>{text}</>;
  if (hasWords(text)) return <EnglishText>{text}</EnglishText>;
  return <>{localUnits(text)}</>;
}

/** Provenance text: the relabelled "Typical value" / "Your input" prefix is
 *  translated, the rest is English backend prose (028 R7). English output is
 *  exactly `plainSource`. */
function SourceText({ text }: { text: string | null | undefined }) {
  const { t, lang } = useT();
  if (!text) return null;
  if (lang === "en") return <>{plainSource(text)}</>;
  const { prefix, rest } = sourceParts(text);
  if (prefix && !rest.trim()) return <>{t(`carsCompare.source.${prefix}`)}</>;
  if (prefix && rest.startsWith(":")) {
    return (
      <>
        {t(`carsCompare.source.${prefix}`)}: <EnglishText>{readableDates(rest.slice(1).trim())}</EnglishText>
      </>
    );
  }
  return <EnglishText>{plainSource(text)}</EnglishText>;
}

export default function OptionDetail() {
  const { t } = useT();
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
        {t("carsCompare.noCars")} <Link to={DRIVE_PATH}>{t("carsCompare.pickSome")}</Link>.
      </p>
    );
  }
  if (!option) {
    return (
      <>
        <Link to={drivePath("/compare")} className="cars-link cars-back">
          {t("carsCompare.detail.back")}
        </Link>
        {scenario.error && (
          <div className="status status--error" role="alert">
            {t("carsCompare.scenarioError")} <EnglishText>{scenario.error}</EnglishText>
          </div>
        )}
        <p className="cars-empty">
          {!data && scenario.loading ? t("carsCompare.detail.loading") : t("carsCompare.detail.notFound")}
        </p>
      </>
    );
  }

  const r = option.result;
  const m = r.measures[state.measure];
  const at = exitMonth;
  const years = at / 12;
  const atExit = m.deterministic[at];
  const lo = m.band.p10[at];
  const hi = m.band.p90[at];
  const rowLabels = r.display["36"] ?? [];
  const items = rowLabels.map((d) => ({
    key: d.key,
    label: displayLabel(d.key, d.label),
    ore: r.display_series?.[d.key]?.[at] ?? 0,
  }));
  const total = items.reduce((s, i) => s + i.ore, 0);
  const maxItem = Math.max(1, ...items.map((i) => Math.abs(i.ore)));
  const perMonthAt = r.measures.per_month.deterministic[at];
  const perKmAt = r.measures.per_km.deterministic[at];
  const bestLease = bestOfKind(data?.options ?? [], option, "lease", state.measure);
  const bestNew = bestOfKind(data?.options ?? [], option, "new", state.measure);
  const isLease = option.option_kind === "lease";

  const priceInput = findInput(r.inputs, "price", "purchase_price");
  const resaleInput = findInput(r.inputs, "resale_path", "resale_retention", "resale_curve");
  const rentInput = findInput(r.inputs, "lease_monthly", "monthly", "lease_rent");
  const purchase = r.purchase_price;
  const sale = r.resale_band?.p50[at] ?? r.resale_p50?.[at] ?? null;
  const saleLo = r.resale_band?.p10[at] ?? null;
  const saleHi = r.resale_band?.p90[at] ?? null;
  const valueLost = r.display_series?.value_lost?.[at] ?? null;
  const sellCost = purchase !== null && sale !== null && valueLost !== null ? valueLost - (purchase - sale) : null;

  const subtitle = [
    isLease
      ? t("carsCompare.leaseTerm", { term: monthsText(36) })
      : t("carsCompare.detail.modelYear", { mode: MODE_LABELS[option.option_kind], year: r.model_year }),
    energyName(r.energy_type, r.fuel),
    option.seller_type === "dealer"
      ? t("carsCompare.detail.fromDealer")
      : option.seller_type === "private"
        ? t("carsCompare.detail.privately")
        : null,
    r.km_at[0] > 0 ? t("carsCompare.detail.onClock", { km: formatKm(r.km_at[0]) }) : null,
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
          {t("carsCompare.detail.back")}
        </Link>
        <div className="cars-titlebar">
          <div className="cars-titlebar__text">
            <h1 className="cars-h1">{r.label}</h1>
            <p className="cars-lede">{subtitle}</p>
          </div>
          <div className="cars-titlebar__tools">
            <Badge status={r.status} estimates={estimateLabels(r)} />
            <MeasureSelect value={state.measure} onChange={setMeasure} />
            {scenario.loading && <span className="cars-hint">{t("carsCompare.updating")}</span>}
          </div>
        </div>
        {scenario.error && (
          <div className="status status--error" role="alert">
            {t("carsCompare.scenarioError")} <EnglishText>{scenario.error}</EnglishText> {t("carsCompare.lastGood")}
          </div>
        )}
      </div>

      <div className="cars-tiles">
        <div className="cars-tile cars-tile--accent">
          <span className="cars-hint">
            {t("carsCompare.detail.atExit", { measure: def.label, years: formatYears(years) })}
          </span>
          <span className="cars-tile__value" data-testid="tile-at-exit">
            {def.format(atExit)}
          </span>
          <span className="cars-hint">
            {t("carsCompare.likely", { lo: def.format(lo), hi: def.format(hi) })}
          </span>
        </div>
        <div className="cars-tile">
          <span className="cars-hint">{t("carsCompare.detail.expected", { measure: measureInSentence(def) })}</span>
          <span className="cars-tile__value" data-testid="tile-expected">
            {def.format(m.expected.p50)}
          </span>
          <span className="cars-hint">{t("carsCompare.detail.expectedHint")}</span>
        </div>
        <div className="cars-tile">
          <span className="cars-hint">{t("carsCompare.detail.bestWorst")}</span>
          <span className="cars-tile__value" data-testid="tile-best">
            {def.format(m.best.value)}
          </span>
          <span className="cars-hint">
            {t("carsCompare.detail.bestWorstHint", {
              bestAt: formatMonths(m.best.month),
              worst: def.format(m.worst.value),
              worstAt: formatMonths(m.worst.month),
            })}
          </span>
        </div>
        <div className="cars-tile">
          <span className="cars-hint">{measureDef("cash_up_front").label}</span>
          <span className="cars-tile__value">{formatNok(r.cash_up_front)}</span>
          <span className="cars-hint">
            {isLease ? t("carsCompare.detail.upfrontRent") : t("carsCompare.detail.downPayment")}
          </span>
        </div>
      </div>

      <section className="cars-card cars-card--wide" aria-labelledby="deal">
        <div className="cars-card__head">
          <h2 id="deal" className="cars-h2">
            {isLease ? t("carsCompare.detail.leaseTitle") : t("carsCompare.detail.buyTitle")}
          </h2>
          <p className="cars-hint">
            {isLease
              ? t("carsCompare.detail.leaseHint", { years: formatYears(years) })
              : t("carsCompare.detail.buyHint", { years: formatYears(years) })}
          </p>
        </div>
        {isLease ? (
          <div className="cars-deal">
            <div className="cars-deal__item">
              <span className="cars-hint">{t("carsCompare.detail.monthlyRent")}</span>
              <span className="cars-deal__value">
                {rentInput ? <ValueText text={String(rentInput.display_value ?? rentInput.value)} /> : "—"}
              </span>
              <span className="cars-deal__meta">
                {rentInput && <Badge status={rentInput.status} />}
                {rentInput && (
                  <span className="cars-hint">
                    <SourceText text={rentInput.source} />
                  </span>
                )}
              </span>
            </div>
            <div className="cars-deal__item">
              <span className="cars-hint">{t("carsCompare.detail.rentPaid", { years: formatYears(years) })}</span>
              <span className="cars-deal__value">{formatNok(r.display_series?.lease_payments?.[at] ?? 0)}</span>
              <span className="cars-hint">{t("carsCompare.detail.rentPaidHint")}</span>
            </div>
            <div className="cars-deal__item">
              <span className="cars-hint">{t("carsCompare.detail.handBack", { years: formatYears(years) })}</span>
              <span className="cars-deal__value">{formatNok(r.display_series?.exit_costs?.[at] ?? 0)}</span>
              <span className="cars-hint">{t("carsCompare.detail.handBackHint")}</span>
            </div>
          </div>
        ) : (
          <div className="cars-deal">
            <div className="cars-deal__item">
              <span className="cars-hint">{t("carsCompare.detail.purchasePrice")}</span>
              <span className="cars-deal__value" data-testid="deal-purchase">
                {purchase !== null ? (
                  formatNok(purchase)
                ) : priceInput ? (
                  <ValueText text={String(priceInput.display_value ?? priceInput.value)} />
                ) : (
                  "—"
                )}
              </span>
              <span className="cars-deal__meta">
                {priceInput && <Badge status={priceInput.status} />}
                {priceInput && (
                  <span className="cars-hint">
                    <SourceText text={priceInput.source} />
                  </span>
                )}
              </span>
            </div>
            <div className="cars-deal__item">
              <span className="cars-hint">{t("carsCompare.detail.salePrice", { years: formatYears(years) })}</span>
              <span className="cars-deal__value" data-testid="deal-sale">
                {sale !== null ? formatNok(sale) : "—"}
              </span>
              <span className="cars-deal__meta">
                {resaleInput && <Badge status={resaleInput.status} />}
                <span className="cars-hint">
                  {saleLo !== null && saleHi !== null ? (
                    t("carsCompare.likely", { lo: formatNok(saleLo), hi: formatNok(saleHi) })
                  ) : resaleInput?.source ? (
                    <SourceText text={resaleInput.source} />
                  ) : (
                    t("carsCompare.detail.marketModel")
                  )}
                </span>
              </span>
            </div>
            <div className="cars-deal__item">
              <span className="cars-hint">{t("carsCompare.detail.valueLost", { years: formatYears(years) })}</span>
              <span className="cars-deal__value" data-testid="deal-value-lost">
                {valueLost !== null ? formatNok(valueLost) : "—"}
              </span>
              <span className="cars-hint">
                {sellCost !== null && sellCost !== 0
                  ? t("carsCompare.detail.valueLostSell", { cost: formatNok(sellCost) })
                  : t("carsCompare.detail.valueLostHint")}
              </span>
            </div>
          </div>
        )}
      </section>

      <div className="cars-layout cars-layout--even">
        <section className="cars-card cars-layout__main" aria-labelledby="exitchart">
          <div className="cars-card__head">
            <h2 id="exitchart" className="cars-h2">
              {t("carsCompare.detail.byLeave", { measure: def.label })}
            </h2>
            <p className="cars-hint">{t("carsCompare.detail.chartHint")}</p>
          </div>
          <ExitChart
            option={option}
            bestLease={bestLease}
            bestNew={bestNew}
            measure={state.measure}
            exitOdds={data?.exit_odds ?? { "12": 0.25, "24": 0.25, "36": 0.25, "48": 0.25 }}
            exitMonth={at}
          />
          <label className="cars-field cars-field--exit">
            <span className="cars-field__label cars-field__label--row">
              <span>{t("carsCompare.markExit")}</span>
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
            <span className="cars-hint">{t("carsCompare.detail.markHint")}</span>
          </label>
        </section>

        <section className="cars-card cars-layout__aside cars-layout__aside--wide" aria-labelledby="money">
          <div className="cars-card__head">
            <h2 id="money" className="cars-h2">
              {t("carsCompare.detail.moneyTitle")}
            </h2>
            <p className="cars-hint">
              {t("carsCompare.detail.moneyHint", {
                years: formatYears(years),
                perMonth: formatNok(perMonthAt),
                perKm: formatPerKm(perKmAt),
              })}
              {state.measure === "npc" && ` ${t("carsCompare.detail.npcNote")}`}
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
            <span>{t("carsCompare.detail.total")}</span>
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
            {t("carsCompare.detail.inputsTitle")}
          </h2>
          <span className="cars-hint">{t("carsCompare.detail.inputsHint")}</span>
        </div>
        <div className="cars-tablewrap">
          <table className="cars-table cars-table--inputs">
            <thead>
              <tr>
                <th scope="col">{t("carsCompare.detail.colInput")}</th>
                <th scope="col">{t("carsCompare.detail.colValue")}</th>
                <th scope="col">{t("carsCompare.detail.colSource")}</th>
                <th scope="col">{t("carsCompare.detail.colStatus")}</th>
                <th scope="col">
                  <span className="sr-only">{t("carsCompare.detail.colAction")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {r.inputs.map((inp) => {
                const overridden = inp.id in state.overrides;
                const label = inputLabel(inp.id, inp.label);
                const range = inp.display_range ?? inp.range;
                return (
                  <tr key={inp.id} data-testid={`input-${inp.id}`}>
                    <td className="cars-strong">
                      {label}
                      {inp.material && <span className="cars-hint"> · {t("carsCompare.detail.keyInput")}</span>}
                    </td>
                    <td>
                      <ValueText text={readableDates(String(inp.display_value ?? inp.value))} />
                      {range && (
                        <div className="cars-hint">
                          {t("carsCompare.detail.range", { lo: localUnits(String(range[0])), hi: localUnits(String(range[1])) })}
                        </div>
                      )}
                    </td>
                    <td className="cars-hint">
                      {isUrl(inp.source) ? (
                        <a href={inp.source} target="_blank" rel="noreferrer" className="cars-link cars-link--wrap">
                          {inp.source.replace(/^https?:\/\/(www\.)?/, "")}
                        </a>
                      ) : (
                        <SourceText text={inp.source} />
                      )}
                      {inp.basis && (
                        <div className="cars-inputs__basis">
                          {t("carsCompare.detail.basis")} <SourceText text={inp.basis} />
                        </div>
                      )}
                    </td>
                    <td>
                      <Badge status={inp.status} />
                      <div className="cars-hint cars-nowrap">{formatDate(inp.as_of)}</div>
                    </td>
                    <td className="cars-table__action">
                      {editing === inp.id ? (
                        <form className="cars-override" onSubmit={(e) => submitOverride(e, inp)}>
                          <label className="cars-field cars-field--inline">
                            <span className="sr-only">{t("carsCompare.detail.newValue", { label })}</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              step="any"
                              className="cars-input cars-input--sm"
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              autoFocus
                            />
                            {inp.unit && (
                              <span className="cars-hint cars-override__unit">
                                <ValueText text={inp.unit} />
                              </span>
                            )}
                          </label>
                          <button type="submit" className="cars-btn cars-btn--sm cars-btn--primary">
                            {t("carsCompare.detail.apply")}
                          </button>
                          <button
                            type="button"
                            className="cars-btn cars-btn--sm"
                            onClick={() => {
                              setEditing(null);
                              setDraft("");
                            }}
                          >
                            {t("carsCompare.detail.cancel")}
                          </button>
                        </form>
                      ) : overridden ? (
                        <button
                          type="button"
                          className="cars-btn cars-btn--sm"
                          onClick={() => clearOverride(inp.id)}
                          aria-label={t("carsCompare.detail.clearFor", { label })}
                        >
                          {t("carsCompare.detail.clear")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="cars-btn cars-btn--sm"
                          onClick={() => {
                            setEditing(inp.id);
                            setDraft("");
                          }}
                          aria-label={t("carsCompare.detail.overrideFor", { label })}
                        >
                          {t("carsCompare.detail.override")}
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
