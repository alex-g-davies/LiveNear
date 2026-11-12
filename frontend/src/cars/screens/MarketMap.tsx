// Market map (spec 023 R2/R3, 024 R9): every model year in the catalogue as a scatter
// of asking prices, a filter rail, box-select and a selection tray that feeds
// Compare. Filters are local state; the selection is the shared one.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { EnergyType, MarketFilters } from "../api";
import EnglishText from "../../components/EnglishText";
import { LANG_TAGS } from "../../i18n/core";
import { useT } from "../../i18n/react";
import MarketScatter from "../components/MarketScatter";
import { useMarket } from "../hooks/useMarket";
import { formatDate } from "../lib/format";
import {
  COLOR_BYS,
  ENERGY_LABELS,
  MAX_COMPARE_VARIANTS,
  X_AXES,
  Y_AXES,
  addPairs,
  capHint,
  dotsFromCohorts,
  dotsFromPoints,
  fullRange,
  matchesSearch,
  removeVariant,
  togglePair,
  variantCount,
  yearRangeLabel,
  type ColorBy,
  type XAxis,
  type YAxis,
} from "../lib/market";
import { useCarState } from "../state";
import "../market.css";
import { drivePath } from "../../lib/productRoutes";

const MIN_YEAR = 2010;
const MAX_YEAR = 2030;

export default function MarketMap() {
  const { t, lang } = useT();
  const navigate = useNavigate();
  const { state, setSelection, vehicles } = useCarState();
  const { selection, profile } = state;
  const catalogue = vehicles.data ?? [];

  const makes = useMemo(() => [...new Set(catalogue.map((v) => v.make))].sort(), [catalogue]);
  const energyTypes = useMemo(
    () => [...new Set(catalogue.map((v) => v.energy_type))] as EnergyType[],
    [catalogue],
  );

  // Filters (local, not persisted).
  const [search, setSearch] = useState("");
  const [make, setMake] = useState("");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [energyOff, setEnergyOff] = useState<EnergyType[]>([]);
  const [hideFailing, setHideFailing] = useState(true);
  const [xAxis, setXAxis] = useState<XAxis>("year");
  const [yAxis, setYAxis] = useState<YAxis>("price");
  const [colorBy, setColorBy] = useState<ColorBy>("energy");
  const [pickerOpen, setPickerOpen] = useState(false);

  const yf = Number(yearFrom);
  const yt = Number(yearTo);
  const mp = Number(maxPrice.replace(/\s/g, ""));
  const mustHaves = hideFailing ? profile.limits.must_haves : [];
  const filters = useMemo<MarketFilters>(() => {
    const f: MarketFilters = {};
    if (make) f.make = make;
    if (yearFrom && Number.isInteger(yf) && yf >= MIN_YEAR && yf <= MAX_YEAR) f.year_from = yf;
    if (yearTo && Number.isInteger(yt) && yt >= MIN_YEAR && yt <= MAX_YEAR) f.year_to = yt;
    if (maxPrice && Number.isFinite(mp) && mp > 0) f.max_price_nok = Math.round(mp);
    const energyOn = energyTypes.filter((e) => !energyOff.includes(e));
    if (energyOff.length && energyOn.length) f.energy_type = energyOn;
    if (mustHaves.length) f.must_have = [...mustHaves];
    return f;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [make, yearFrom, yearTo, maxPrice, energyOff.join(","), energyTypes.join(","), mustHaves.join(","), yf, yt, mp]);

  const market = useMarket(filters);
  const cohorts = market.cohorts?.cohorts ?? [];
  const points = market.points?.points ?? [];
  const noneSelectedEnergy = energyTypes.length > 0 && energyOff.length === energyTypes.length;
  const usePoints = (market.points?.listings_mode ?? "unavailable") !== "unavailable" && points.length > 0;

  const dots = useMemo(() => {
    if (noneSelectedEnergy) return [];
    const visibleCohorts = cohorts.filter((c) => (!hideFailing || c.meets_must_haves) && matchesSearch({ label: `${c.make} ${c.model} ${c.trim_group}` }, search));
    const all = usePoints ? dotsFromPoints(points, visibleCohorts) : dotsFromCohorts(visibleCohorts);
    return all;
  }, [cohorts, points, usePoints, hideFailing, search, noneSelectedEnergy]);

  const pointsByVariant = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of dots) m.set(d.variant_id, (m.get(d.variant_id) ?? 0) + (d.isCohort ? 0 : 1));
    return m;
  }, [dots]);

  const byId = useMemo(() => new Map(catalogue.map((v) => [v.variant_id, v])), [catalogue]);
  const selectedVariants = [...new Set(selection.map((s) => s.variant_id))];
  const nListings = market.points?.n_points ?? market.cohorts?.n_listings_total ?? 0;
  const asOf = market.cohorts?.bundle_as_of ?? market.points?.bundle_as_of ?? null;

  const toggleEnergy = (e: EnergyType, on: boolean) =>
    setEnergyOff((cur) => (on ? cur.filter((x) => x !== e) : cur.includes(e) ? cur : [...cur, e]));

  return (
    <>
      <div className="cars-titlebar">
        <div className="cars-titlebar__text">
          <h1 className="cars-h1">{t("carsPlan.market.title")}</h1>
          <p className="cars-lede">{t("carsPlan.market.lede")}</p>
        </div>
        <div className="cars-titlebar__tools">
          <span className="cars-hint" data-testid="market-count">
            {t("carsPlan.market.count", { count: nListings, date: formatDate(asOf) })}
            {market.loading && <span className="cars-hint__loading">{t("carsPlan.market.updating")}</span>}
          </span>
        </div>
      </div>

      <div className="cars-layout cars-layout--rail-left">
        <aside className="cars-layout__aside" aria-label={t("carsPlan.market.filters")}>
          <section className="cars-card">
            <label className="cars-field">
              <span className="cars-field__label">{t("carsPlan.market.brand")}</span>
              <select className="cars-select" value={make} onChange={(e) => setMake(e.target.value)}>
                <option value="">{t("carsPlan.market.allBrands")}</option>
                {makes.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="cars-field">
              <span className="cars-field__label">{t("carsPlan.market.find")}</span>
              <input
                type="search"
                className="cars-input"
                placeholder={t("carsPlan.market.findPlaceholder", { example: "Model 3" })}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div className="cars-grid cars-grid--2">
              <label className="cars-field">
                <span className="cars-field__label cars-field__label--muted">{t("carsPlan.market.yearFrom")}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  className="cars-input"
                  min={MIN_YEAR}
                  max={MAX_YEAR}
                  value={yearFrom}
                  onChange={(e) => setYearFrom(e.target.value)}
                />
              </label>
              <label className="cars-field">
                <span className="cars-field__label cars-field__label--muted">{t("carsPlan.market.yearTo")}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  className="cars-input"
                  min={MIN_YEAR}
                  max={MAX_YEAR}
                  value={yearTo}
                  onChange={(e) => setYearTo(e.target.value)}
                />
              </label>
            </div>
            <label className="cars-field">
              <span className="cars-field__label">{t("carsPlan.market.maxAsk")}</span>
              <span className="cars-field__unit">
                <input
                  type="text"
                  inputMode="numeric"
                  className="cars-input"
                  placeholder="kr"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                />
                <span className="cars-hint">kr</span>
              </span>
            </label>
            <fieldset className="cars-fieldset">
              <legend className="cars-legend-label">{t("carsPlan.market.energy")}</legend>
              <div className="cars-market__energy">
                {energyTypes.map((e) => (
                  <label key={e} className="cars-check">
                    <input
                      type="checkbox"
                      checked={!energyOff.includes(e)}
                      onChange={(ev) => toggleEnergy(e, ev.target.checked)}
                    />{" "}
                    {ENERGY_LABELS[e]}
                  </label>
                ))}
                {energyTypes.length === 0 && <span className="cars-hint">{t("carsPlan.market.loadingCatalogue")}</span>}
              </div>
            </fieldset>
            <label className="cars-check cars-check--top">
              <input type="checkbox" checked={hideFailing} onChange={(e) => setHideFailing(e.target.checked)} />{" "}
              {t("carsPlan.market.hideFailing")}
              {profile.limits.must_haves.length === 0 && <span className="cars-hint">{t("carsPlan.market.noneSet")}</span>}
            </label>
          </section>
        </aside>

        <div className="cars-layout__main">
          <section className="cars-card" aria-labelledby="market-plot">
            <div className="cars-market__head">
              <h2 id="market-plot" className="cars-h2">
                {t("carsPlan.market.plotTitle", {
                  y: Y_AXES.find((a) => a.key === yAxis)!.label,
                  x: X_AXES.find((a) => a.key === xAxis)!.label.toLocaleLowerCase(LANG_TAGS[lang]),
                })}
              </h2>
              <div className="cars-market__axes">
                <label className="cars-field cars-field--inline">
                  <span className="cars-field__label cars-field__label--muted">{t("carsPlan.market.xAxis")}</span>
                  <select className="cars-select cars-select--sm" value={xAxis} onChange={(e) => setXAxis(e.target.value as XAxis)}>
                    {X_AXES.map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="cars-field cars-field--inline">
                  <span className="cars-field__label cars-field__label--muted">{t("carsPlan.market.yAxis")}</span>
                  <select className="cars-select cars-select--sm" value={yAxis} onChange={(e) => setYAxis(e.target.value as YAxis)}>
                    {Y_AXES.map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="cars-market__colorby">
              <span className="cars-hint">{t("carsPlan.market.colourBy")}</span>
              <div role="group" aria-label={t("carsPlan.market.colourBy")} className="cars-filters">
                {COLOR_BYS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className="cars-filter"
                    aria-pressed={colorBy === c.key}
                    onClick={() => setColorBy(c.key)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            {market.error && (
              <div className="status status--error" role="alert">
                {t("carsPlan.market.error")} <EnglishText>{market.error}</EnglishText>
              </div>
            )}
            {!usePoints && dots.length > 0 && (
              <p className="cars-market__fallback" data-testid="market-fallback">
                {t("carsPlan.market.fallback")}
              </p>
            )}
            {!market.loading && dots.length === 0 && !market.error && (
              <p className="cars-empty">{t("carsPlan.market.empty")}</p>
            )}
            <MarketScatter
              dots={dots}
              xAxis={xAxis}
              yAxis={yAxis}
              colorBy={colorBy}
              selection={selection}
              onToggle={(vid, year) => setSelection(togglePair(selection, vid, year))}
              onBoxSelect={(pairs) => setSelection(addPairs(selection, pairs))}
            />
          </section>

          <section className="cars-card" aria-labelledby="market-selection">
            <div className="cars-card__bar cars-card__bar--plain">
              <h2 id="market-selection" className="cars-h2">
                {t("carsPlan.market.selection")}
              </h2>
              <span className="cars-hint" data-testid="selection-summary">
                {t("carsPlan.market.models", { count: selectedVariants.length })} ·{" "}
                {t("carsPlan.market.listings", {
                  count: selectedVariants.reduce((n, vid) => n + (pointsByVariant.get(vid) ?? 0), 0),
                })}
              </span>
            </div>
            <div className="cars-market__tray">
              {selectedVariants.map((vid) => {
                const v = byId.get(vid);
                const name = v ? `${v.make} ${v.model} ${v.trim_group}` : vid;
                return (
                  <div key={vid} className="cars-market__sel" data-testid="selection-chip">
                    <div className="cars-market__sel-text">
                      <span className="cars-market__sel-name">{name}</span>
                      <span className="cars-market__sel-sub">
                        {yearRangeLabel(selection, vid)} ·{" "}
                        {t("carsPlan.market.listings", { count: pointsByVariant.get(vid) ?? 0 })}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="cars-market__remove"
                      aria-label={t("carsPlan.market.remove", { name })}
                      onClick={() => setSelection(removeVariant(selection, vid))}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              <button
                type="button"
                className="cars-market__add"
                aria-expanded={pickerOpen}
                onClick={() => setPickerOpen((o) => !o)}
              >
                {pickerOpen ? t("carsPlan.market.close") : t("carsPlan.market.addModel")}
              </button>
            </div>
            {pickerOpen && (
              <div className="cars-market__picker" role="group" aria-label={t("carsPlan.market.addModel")}>
                {catalogue.map((v) => {
                  const on = selection.some((s) => s.variant_id === v.variant_id);
                  const name = `${v.make} ${v.model} ${v.trim_group}`;
                  return (
                    <label key={v.variant_id} className="cars-check">
                      <input
                        type="checkbox"
                        checked={on}
                        aria-label={name}
                        onChange={(e) =>
                          setSelection(
                            e.target.checked
                              ? [...removeVariant(selection, v.variant_id), fullRange(v)]
                              : removeVariant(selection, v.variant_id),
                          )
                        }
                      />{" "}
                      {name}
                      <span className="cars-hint">
                        {" "}
                        · {Math.min(...v.model_years)}–{Math.max(...v.model_years)}
                      </span>
                    </label>
                  );
                })}
                {catalogue.length === 0 && <span className="cars-hint">{t("carsPlan.market.loadingCatalogue")}</span>}
              </div>
            )}
            <div className="cars-actions">
              {selection.length === 0 && <span className="cars-hint">{t("carsPlan.market.pickOne")}</span>}
              {variantCount(selection) >= MAX_COMPARE_VARIANTS && (
                <span className="cars-hint" role="status" data-testid="market-full">
                  {capHint()}
                </span>
              )}
              <button type="button" className="cars-btn" onClick={() => setSelection([])} disabled={selection.length === 0}>
                {t("carsPlan.market.clear")}
              </button>
              <button
                type="button"
                className="cars-btn cars-btn--primary"
                disabled={selection.length === 0}
                onClick={() => navigate(drivePath("/compare"))}
              >
                {t("carsPlan.market.compare")}
              </button>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
