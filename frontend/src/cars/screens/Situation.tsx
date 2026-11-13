// "Your situation" (spec 022 R11, 024 R5/R10/R12): the profile form. Exit odds
// and charging mix must each total 100 % before Continue is enabled; limits
// are filters. The selection is a compact tray (chips + typeahead); the
// Market screen is the browsing surface.

import { useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { StartHereCard } from "../components/Recommendations";
import SelectionTray from "../components/SelectionTray";
import { MAX_COMPARE_VARIANTS, variantCount } from "../lib/market";
import { MODE_LABELS } from "../lib/measures";
import {
  AGE_BANDS,
  MODES,
  MUST_HAVES,
  chargingSum,
  exitOddsSum,
  type ExitKey,
  type Mode,
  type MustHave,
} from "../lib/profile";
import { useCarState } from "../state";
import { t } from "../../i18n/core";
import { useT } from "../../i18n/react";
import { drivePath } from "../../lib/productRoutes";

// Labels are getters, so each read is in the current language (spec 028).
const EXIT_FIELDS: { key: ExitKey; readonly label: string }[] = [
  { key: "p12", get label() { return t("carsPlan.situation.exit.about", { count: 1 }); } },
  { key: "p24", get label() { return t("carsPlan.situation.exit.about", { count: 2 }); } },
  { key: "p36", get label() { return t("carsPlan.situation.exit.about", { count: 3 }); } },
  { key: "p48", get label() { return t("carsPlan.situation.exit.plus", { n: 4 }); } },
];
const ODDS_SHADES = ["var(--c-neutral-400)", "var(--c-neutral-500)", "var(--c-neutral-600)", "var(--c-neutral-700)"];

const mustLabel = (m: MustHave): string => t(`carsPlan.situation.must.${m}`);

const numOf = (e: ChangeEvent<HTMLInputElement>): number => {
  const n = Number(e.target.value);
  return Number.isFinite(n) ? n : 0;
};

export default function Situation() {
  const { t } = useT();
  const { state, updateProfile, setSelection, saveDraft, vehicles } = useCarState();
  const navigate = useNavigate();
  const { profile, selection } = state;
  const [saved, setSaved] = useState<boolean | null>(null);
  const [showQuotes, setShowQuotes] = useState(Object.keys(profile.insurance_quotes_nok).length > 0);

  const oddsTotal = exitOddsSum(profile.exit_odds);
  const chargeTotal = chargingSum(profile.charging_mix);
  const oddsOk = oddsTotal === 100;
  const chargeOk = chargeTotal === 100;
  const selectionOk = selection.length > 0;
  const canContinue = oddsOk && chargeOk && selectionOk;

  const toggleList = <T extends string>(list: T[], item: T, on: boolean): T[] =>
    on ? (list.includes(item) ? list : [...list, item]) : list.filter((x) => x !== item);

  const onSave = () => {
    setSaved(saveDraft());
  };

  const selectedVehicles = (vehicles.data ?? []).filter((v) =>
    selection.some((s) => s.variant_id === v.variant_id),
  );

  return (
    <>
      <div className="cars-titlebar">
        <div className="cars-titlebar__text">
          <h1 className="cars-h1">{t("carsPlan.situation.title")}</h1>
          <p className="cars-lede">{t("carsPlan.situation.lede")}</p>
        </div>
      </div>

      <div className="cars-cards">
        <section className="cars-card" aria-labelledby="hold">
          <div className="cars-card__head">
            <h2 id="hold" className="cars-h2">
              {t("carsPlan.situation.hold.title")}
            </h2>
            <p className="cars-hint">{t("carsPlan.situation.hold.hint", { total: 100 })}</p>
          </div>
          <div className="cars-grid cars-grid--4">
            {EXIT_FIELDS.map((f) => (
              <label key={f.key} className="cars-field">
                <span className="cars-field__label">{f.label}</span>
                <span className="cars-field__unit">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    className="cars-input"
                    value={profile.exit_odds[f.key]}
                    onChange={(e) =>
                      updateProfile({ exit_odds: { ...profile.exit_odds, [f.key]: numOf(e) } })
                    }
                  />
                  <span aria-hidden="true">%</span>
                </span>
              </label>
            ))}
          </div>
          <div className="cars-oddsbar" aria-hidden="true">
            {EXIT_FIELDS.map((f, i) => (
              <div
                key={f.key}
                className="cars-oddsbar__seg"
                style={{ width: `${Math.max(0, Math.min(100, profile.exit_odds[f.key]))}%`, background: ODDS_SHADES[i] }}
              />
            ))}
          </div>
          <p className={`cars-gate ${oddsOk ? "cars-gate--ok" : "cars-gate--bad"}`} role="status">
            {oddsOk
              ? t("carsPlan.situation.oddsOk", { total: 100 })
              : t("carsPlan.situation.oddsBad", { sum: oddsTotal, total: 100 })}
          </p>
          <fieldset className="cars-fieldset">
            <legend className="cars-legend-label">{t("carsPlan.situation.exitLegend")}</legend>
            <div className="cars-inline">
              <label className="cars-check">
                <input
                  type="radio"
                  name="exit"
                  checked={!profile.export_on_exit}
                  onChange={() => updateProfile({ export_on_exit: false })}
                />{" "}
                {t("carsPlan.situation.soldHere")}
              </label>
              <label className="cars-check">
                <input
                  type="radio"
                  name="exit"
                  checked={profile.export_on_exit}
                  onChange={() => updateProfile({ export_on_exit: true })}
                />{" "}
                {t("carsPlan.situation.exported")}
              </label>
            </div>
          </fieldset>
        </section>

        <section className="cars-card" aria-labelledby="drive">
          <div className="cars-card__head">
            <h2 id="drive" className="cars-h2">
              {t("carsPlan.situation.drive.title")}
            </h2>
            <p className="cars-hint">{t("carsPlan.situation.drive.hint")}</p>
          </div>
          <label className="cars-field">
            <span className="cars-field__label">{t("carsPlan.situation.km")}</span>
            <span className="cars-field__unit">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1000}
                className="cars-input"
                value={profile.km_per_year}
                onChange={(e) => updateProfile({ km_per_year: numOf(e) })}
              />
              <span aria-hidden="true">km</span>
            </span>
          </label>
          <div className="cars-field">
            <span className="cars-field__label">{t("carsPlan.situation.chargeWhere")}</span>
            <p className="cars-hint">{t("carsPlan.situation.chargeEvOnly")}</p>
            <div className="cars-grid cars-grid--3">
              {(
                [
                  ["work_free_pct", t("carsPlan.situation.charge.work")],
                  ["home_pct", t("carsPlan.situation.charge.home")],
                  ["public_pct", t("carsPlan.situation.charge.public")],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="cars-field">
                  <span className="cars-field__label cars-field__label--muted">{label}</span>
                  <span className="cars-field__unit">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100}
                      className="cars-input"
                      value={profile.charging_mix[key]}
                      onChange={(e) =>
                        updateProfile({ charging_mix: { ...profile.charging_mix, [key]: numOf(e) } })
                      }
                    />
                    <span aria-hidden="true">%</span>
                  </span>
                </label>
              ))}
            </div>
            <p className={`cars-gate ${chargeOk ? "cars-gate--ok" : "cars-gate--bad"}`} role="status">
              {chargeOk
                ? t("carsPlan.situation.chargeOk", { total: 100 })
                : t("carsPlan.situation.chargeBad", { sum: chargeTotal, total: 100 })}
            </p>
          </div>
          <div className="cars-grid cars-grid--2">
            <label className="cars-field">
              <span className="cars-field__label">{t("carsPlan.situation.homeArea")}</span>
              <input
                type="text"
                className="cars-input"
                placeholder={t("carsPlan.situation.municipality")}
                value={profile.municipality}
                onChange={(e) => updateProfile({ municipality: e.target.value })}
              />
            </label>
            <label className="cars-field">
              <span className="cars-field__label">{t("carsPlan.situation.tollPassages")}</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={200}
                className="cars-input"
                value={profile.toll_passages_per_week}
                onChange={(e) =>
                  updateProfile({ toll_passages_per_week: Math.max(0, Math.min(200, Math.round(numOf(e)))) })
                }
              />
              <span className="cars-hint">{t("carsPlan.situation.tollHint")}</span>
            </label>
          </div>
        </section>

        <section className="cars-card" aria-labelledby="money">
          <h2 id="money" className="cars-h2">
            {t("carsPlan.situation.money.title")}
          </h2>
          <fieldset className="cars-fieldset">
            <legend className="cars-legend-label">{t("carsPlan.situation.payWith")}</legend>
            <div className="cars-inline">
              {(
                [
                  ["cash", t("carsPlan.situation.pay.cash")],
                  ["loan", t("carsPlan.situation.pay.loan")],
                  ["both", t("carsPlan.situation.pay.both")],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="cars-check">
                  <input
                    type="radio"
                    name="pay"
                    checked={profile.pay_mode === key}
                    onChange={() => updateProfile({ pay_mode: key })}
                  />{" "}
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="cars-grid cars-grid--2">
            <label className="cars-field">
              <span className="cars-field__label">{t("carsPlan.situation.returnOnCash")}</span>
              <span className="cars-field__unit">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={50}
                  step={0.5}
                  className="cars-input"
                  value={profile.return_on_cash_pct}
                  onChange={(e) => updateProfile({ return_on_cash_pct: numOf(e) })}
                />
                <span aria-hidden="true">{t("carsPlan.situation.pctPerYear")}</span>
              </span>
            </label>
            <label className="cars-field">
              <span className="cars-field__label">{t("carsPlan.situation.downPayment")}</span>
              <span className="cars-field__unit">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={10000}
                  className="cars-input"
                  value={profile.down_payment_nok}
                  onChange={(e) => updateProfile({ down_payment_nok: numOf(e) })}
                />
                <span aria-hidden="true">kr</span>
              </span>
            </label>
          </div>
          <label className="cars-check">
            <input
              type="checkbox"
              checked={profile.has_id_and_bankid}
              onChange={(e) => updateProfile({ has_id_and_bankid: e.target.checked })}
            />{" "}
            {t("carsPlan.situation.bankId")}
          </label>
        </section>

        <section className="cars-card" aria-labelledby="ins">
          <div className="cars-card__head">
            <h2 id="ins" className="cars-h2">
              {t("carsPlan.situation.ins.title")}
            </h2>
            <p className="cars-hint">{t("carsPlan.situation.ins.hint")}</p>
          </div>
          <div className="cars-grid cars-grid--2">
            <label className="cars-field">
              <span className="cars-field__label">{t("carsPlan.situation.ins.claimsFree")}</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={60}
                className="cars-input"
                value={profile.insurance.claims_free_years}
                onChange={(e) =>
                  updateProfile({ insurance: { ...profile.insurance, claims_free_years: numOf(e) } })
                }
              />
            </label>
            <label className="cars-field">
              <span className="cars-field__label">{t("carsPlan.situation.ins.ageBand")}</span>
              <select
                className="cars-select"
                value={profile.insurance.age_band}
                onChange={(e) =>
                  updateProfile({
                    insurance: { ...profile.insurance, age_band: e.target.value as (typeof AGE_BANDS)[number] },
                  })
                }
              >
                {AGE_BANDS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="cars-check">
            <input
              type="checkbox"
              checked={profile.insurance.has_claims_free_letter}
              onChange={(e) =>
                updateProfile({ insurance: { ...profile.insurance, has_claims_free_letter: e.target.checked } })
              }
            />{" "}
            {t("carsPlan.situation.ins.letter")}
          </label>
          <label className="cars-check">
            <input
              type="checkbox"
              checked={showQuotes}
              onChange={(e) => {
                setShowQuotes(e.target.checked);
                if (!e.target.checked) updateProfile({ insurance_quotes_nok: {} });
              }}
            />{" "}
            {t("carsPlan.situation.ins.ownQuotes")}
          </label>
          {showQuotes && (
            <div className="cars-grid cars-grid--2">
              {selectedVehicles.length === 0 && <p className="cars-hint">{t("carsPlan.situation.ins.pickFirst")}</p>}
              {selectedVehicles.map((v) => (
                <label key={v.variant_id} className="cars-field">
                  <span className="cars-field__label">
                    {t("carsPlan.situation.ins.quote", { name: `${v.make} ${v.model} ${v.trim_group}` })}
                  </span>
                  <span className="cars-field__unit">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      className="cars-input"
                      value={profile.insurance_quotes_nok[v.variant_id] ?? ""}
                      onChange={(e) => {
                        const next = { ...profile.insurance_quotes_nok };
                        if (e.target.value === "") delete next[v.variant_id];
                        else next[v.variant_id] = numOf(e);
                        updateProfile({ insurance_quotes_nok: next });
                      }}
                    />
                    <span aria-hidden="true">{t("carsPlan.situation.krPerYear")}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </section>

        <section className="cars-card" aria-labelledby="limits">
          <div className="cars-card__head">
            <h2 id="limits" className="cars-h2">
              {t("carsPlan.situation.limits.title")}
            </h2>
            <p className="cars-hint">{t("carsPlan.situation.limits.hint")}</p>
          </div>
          <div className="cars-grid cars-grid--2">
            <label className="cars-field">
              <span className="cars-field__label">{t("carsPlan.situation.limits.maxPrice")}</span>
              <span className="cars-field__unit">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={10000}
                  className="cars-input"
                  value={profile.limits.max_price_nok ?? ""}
                  onChange={(e) =>
                    updateProfile({
                      limits: { ...profile.limits, max_price_nok: e.target.value === "" ? null : numOf(e) },
                    })
                  }
                />
                <span aria-hidden="true">kr</span>
              </span>
            </label>
            <label className="cars-field">
              <span className="cars-field__label">{t("carsPlan.situation.limits.needBy")}</span>
              <input
                type="date"
                className="cars-input"
                value={profile.limits.need_by ?? ""}
                onChange={(e) =>
                  updateProfile({ limits: { ...profile.limits, need_by: e.target.value || null } })
                }
              />
            </label>
            <label className="cars-field">
              <span className="cars-field__label">{t("carsPlan.situation.limits.arrival")}</span>
              <input
                type="date"
                className="cars-input"
                value={profile.arrival_date ?? ""}
                onChange={(e) => updateProfile({ arrival_date: e.target.value || null })}
              />
              <span className="cars-hint">{t("carsPlan.situation.limits.arrivalHint")}</span>
            </label>
          </div>
          <fieldset className="cars-fieldset">
            <legend className="cars-legend-label">{t("carsPlan.situation.limits.mustHave")}</legend>
            <div className="cars-inline">
              {MUST_HAVES.map((m) => (
                <label key={m} className="cars-check">
                  <input
                    type="checkbox"
                    checked={profile.limits.must_haves.includes(m)}
                    onChange={(e) =>
                      updateProfile({
                        limits: {
                          ...profile.limits,
                          must_haves: toggleList(profile.limits.must_haves, m, e.target.checked),
                        },
                      })
                    }
                  />{" "}
                  {mustLabel(m)}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="cars-fieldset">
            <legend className="cars-legend-label">{t("carsPlan.situation.limits.ways")}</legend>
            <div className="cars-inline">
              {MODES.map((m: Mode) => (
                <label key={m} className="cars-check">
                  <input
                    type="checkbox"
                    checked={profile.limits.modes.includes(m)}
                    onChange={(e) =>
                      updateProfile({
                        limits: { ...profile.limits, modes: toggleList(profile.limits.modes, m, e.target.checked) },
                      })
                    }
                  />{" "}
                  {MODE_LABELS[m]}
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="cars-card" aria-labelledby="prio">
          <div className="cars-card__head">
            <h2 id="prio" className="cars-h2">
              {t("carsPlan.situation.prio.title")}
            </h2>
            <p className="cars-hint">{t("carsPlan.situation.prio.hint")}</p>
          </div>
          <label className="cars-field">
            <span className="cars-field__label">{t("carsPlan.situation.prio.slider")}</span>
            <input
              type="range"
              min={0}
              max={100}
              className="cars-slider"
              value={profile.fun_weight}
              onChange={(e) => updateProfile({ fun_weight: numOf(e) })}
            />
            <span className="cars-slider__ends">
              <span>{t("carsPlan.situation.prio.utility")}</span>
              <span>{t("carsPlan.situation.prio.fun")}</span>
            </span>
          </label>
        </section>

        <StartHereCard />

        <section className="cars-card cars-card--wide" aria-labelledby="pick">
          <div className="cars-card__head">
            <h2 id="pick" className="cars-h2">
              {t("carsPlan.situation.pick.title")}
            </h2>
            <p className="cars-hint">
              {t("carsPlan.situation.pick.hint")}
              {selection.length > 0 &&
                ` ${t("carsPlan.situation.pick.count", { n: variantCount(selection), max: MAX_COMPARE_VARIANTS })}`}
            </p>
          </div>
          <SelectionTray
            vehicles={vehicles.data ?? []}
            selection={selection}
            onChange={setSelection}
            loading={vehicles.loading}
            error={vehicles.error}
          />
        </section>
      </div>

      <div className="cars-actions">
        {!canContinue && (
          <p className="cars-gate cars-gate--bad" role="status">
            {!oddsOk
              ? t("carsPlan.situation.fixOdds")
              : !chargeOk
                ? t("carsPlan.situation.fixCharging")
                : t("carsPlan.situation.pickOne")}
          </p>
        )}
        {saved !== null && (
          <p className="cars-hint" role="status">
            {saved ? t("carsPlan.situation.saved") : t("carsPlan.situation.saveFailed")}
          </p>
        )}
        <button type="button" className="cars-btn" onClick={onSave}>
          {t("carsPlan.situation.save")}
        </button>
        <Link to={drivePath("/market")} className="cars-btn cars-btn--outline">
          {t("carsPlan.situation.browse")}
        </Link>
        <button
          type="button"
          className="cars-btn cars-btn--primary"
          disabled={!canContinue}
          onClick={() => navigate(drivePath("/compare"))}
        >
          {t("carsPlan.situation.compare")}
        </button>
      </div>
    </>
  );
}
