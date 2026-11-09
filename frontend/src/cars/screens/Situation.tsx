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
import { drivePath } from "../../lib/productRoutes";

const EXIT_FIELDS: { key: ExitKey; label: string }[] = [
  { key: "p12", label: "About 1 year" },
  { key: "p24", label: "About 2 years" },
  { key: "p36", label: "About 3 years" },
  { key: "p48", label: "4+ years" },
];
const ODDS_SHADES = ["var(--c-neutral-400)", "var(--c-neutral-500)", "var(--c-neutral-600)", "var(--c-neutral-700)"];

const MUST_LABELS: Record<MustHave, string> = {
  heat_pump: "Heat pump",
  auto_precondition: "Automatic battery preconditioning",
  awd: "AWD",
};

const numOf = (e: ChangeEvent<HTMLInputElement>): number => {
  const n = Number(e.target.value);
  return Number.isFinite(n) ? n : 0;
};

export default function Situation() {
  const { state, updateProfile, setSelection, saveDraft, vehicles } = useCarState();
  const navigate = useNavigate();
  const { profile, selection } = state;
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
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
    setSavedMsg(saveDraft() ? "Draft saved on this device." : "Could not save: browser storage is unavailable.");
  };

  const selectedVehicles = (vehicles.data ?? []).filter((v) =>
    selection.some((s) => s.variant_id === v.variant_id),
  );

  return (
    <>
      <div className="cars-titlebar">
        <div className="cars-titlebar__text">
          <h1 className="cars-h1">Your situation</h1>
          <p className="cars-lede">
            About five minutes. Every answer can be changed later, and the results show how much each one
            moves the ranking.
          </p>
        </div>
      </div>

      <div className="cars-cards">
        <section className="cars-card" aria-labelledby="hold">
          <div className="cars-card__head">
            <h2 id="hold" className="cars-h2">
              How long will you keep the car?
            </h2>
            <p className="cars-hint">
              Give your rough odds. They don't need to be precise, but they must add up to 100%.
            </p>
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
            {oddsOk ? "Odds add up to 100 %." : `Odds add up to ${oddsTotal} %. They must total 100 %.`}
          </p>
          <fieldset className="cars-fieldset">
            <legend className="cars-legend-label">If you leave Norway, the car is</legend>
            <div className="cars-inline">
              <label className="cars-check">
                <input
                  type="radio"
                  name="exit"
                  checked={!profile.export_on_exit}
                  onChange={() => updateProfile({ export_on_exit: false })}
                />{" "}
                Sold here
              </label>
              <label className="cars-check">
                <input
                  type="radio"
                  name="exit"
                  checked={profile.export_on_exit}
                  onChange={() => updateProfile({ export_on_exit: true })}
                />{" "}
                Exported with me
              </label>
            </div>
          </fieldset>
        </section>

        <section className="cars-card" aria-labelledby="drive">
          <div className="cars-card__head">
            <h2 id="drive" className="cars-h2">
              Driving and charging
            </h2>
            <p className="cars-hint">How far you drive affects resale value and lease km limits, not just energy.</p>
          </div>
          <label className="cars-field">
            <span className="cars-field__label">Km per year</span>
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
            <span className="cars-field__label">Where you charge (share of energy)</span>
            <div className="cars-grid cars-grid--3">
              {(
                [
                  ["work_free_pct", "Free at work"],
                  ["home_pct", "Home"],
                  ["public_pct", "Public fast"],
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
                ? "Charging shares add up to 100 %."
                : `Charging shares add up to ${chargeTotal} %. They must total 100 %.`}
            </p>
          </div>
          <div className="cars-grid cars-grid--2">
            <label className="cars-field">
              <span className="cars-field__label">Home area (for tolls and climate)</span>
              <input
                type="text"
                className="cars-input"
                placeholder="Municipality"
                value={profile.municipality}
                onChange={(e) => updateProfile({ municipality: e.target.value })}
              />
            </label>
            <label className="cars-field">
              <span className="cars-field__label">Toll ring passages per week</span>
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
              <span className="cars-hint">
                Trips through the toll ring per week, both directions count. Leave 0 if you will not commute
                through one.
              </span>
            </label>
          </div>
        </section>

        <section className="cars-card" aria-labelledby="money">
          <h2 id="money" className="cars-h2">
            Money
          </h2>
          <fieldset className="cars-fieldset">
            <legend className="cars-legend-label">If buying, you would pay with</legend>
            <div className="cars-inline">
              {(
                [
                  ["cash", "Cash"],
                  ["loan", "Car loan"],
                  ["both", "Compare both"],
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
              <span className="cars-field__label">Return your cash earns elsewhere</span>
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
                <span aria-hidden="true">% per year</span>
              </span>
            </label>
            <label className="cars-field">
              <span className="cars-field__label">Down payment available</span>
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
                <span aria-hidden="true">NOK</span>
              </span>
            </label>
          </div>
          <label className="cars-check">
            <input
              type="checkbox"
              checked={profile.has_id_and_bankid}
              onChange={(e) => updateProfile({ has_id_and_bankid: e.target.checked })}
            />{" "}
            I have a Norwegian ID number and BankID (needed for most loans)
          </label>
        </section>

        <section className="cars-card" aria-labelledby="ins">
          <div className="cars-card__head">
            <h2 id="ins" className="cars-h2">
              Insurance profile
            </h2>
            <p className="cars-hint">Norwegian insurers price by claims-free history. Newcomers often start low.</p>
          </div>
          <div className="cars-grid cars-grid--2">
            <label className="cars-field">
              <span className="cars-field__label">Years claims-free</span>
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
              <span className="cars-field__label">Age band</span>
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
            I can get a claims-free letter from my previous insurer
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
            I have my own insurance quotes to enter
          </label>
          {showQuotes && (
            <div className="cars-grid cars-grid--2">
              {selectedVehicles.length === 0 && <p className="cars-hint">Pick cars below first.</p>}
              {selectedVehicles.map((v) => (
                <label key={v.variant_id} className="cars-field">
                  <span className="cars-field__label">
                    {v.make} {v.model} {v.trim_group} quote
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
                    <span aria-hidden="true">NOK per year</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </section>

        <section className="cars-card" aria-labelledby="limits">
          <div className="cars-card__head">
            <h2 id="limits" className="cars-h2">
              Limits
            </h2>
            <p className="cars-hint">These rule options out. They are never traded off against cost.</p>
          </div>
          <div className="cars-grid cars-grid--2">
            <label className="cars-field">
              <span className="cars-field__label">Max purchase price</span>
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
                <span aria-hidden="true">NOK</span>
              </span>
            </label>
            <label className="cars-field">
              <span className="cars-field__label">Need the car by</span>
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
              <span className="cars-field__label">When did/will you arrive in Norway?</span>
              <input
                type="date"
                className="cars-input"
                value={profile.arrival_date ?? ""}
                onChange={(e) => updateProfile({ arrival_date: e.target.value || null })}
              />
              <span className="cars-hint">Optional; sets the deadlines on the checklist.</span>
            </label>
          </div>
          <fieldset className="cars-fieldset">
            <legend className="cars-legend-label">Must have</legend>
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
                  {MUST_LABELS[m]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="cars-fieldset">
            <legend className="cars-legend-label">Ways to get a car</legend>
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
              What matters besides cost
            </h2>
            <p className="cars-hint">Shown as a separate score next to cost, never folded into it.</p>
          </div>
          <label className="cars-field">
            <span className="cars-field__label">Utility vs fun</span>
            <input
              type="range"
              min={0}
              max={100}
              className="cars-slider"
              value={profile.fun_weight}
              onChange={(e) => updateProfile({ fun_weight: numOf(e) })}
            />
            <span className="cars-slider__ends">
              <span>Range, space, comfort</span>
              <span>Punch, agility, RWD</span>
            </span>
          </label>
        </section>

        <StartHereCard />

        <section className="cars-card cars-card--wide" aria-labelledby="pick">
          <div className="cars-card__head">
            <h2 id="pick" className="cars-h2">
              Cars to compare
            </h2>
            <p className="cars-hint">
              The cars and model years to put side by side. Add one by name here, or pick from the Market
              map.
              {selection.length > 0 && ` ${variantCount(selection)} of ${MAX_COMPARE_VARIANTS} cars selected.`}
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
              ? "Fix the exit odds to continue."
              : !chargeOk
                ? "Fix the charging shares to continue."
                : "Pick at least one car to compare."}
          </p>
        )}
        {savedMsg && (
          <p className="cars-hint" role="status">
            {savedMsg}
          </p>
        )}
        <button type="button" className="cars-btn" onClick={onSave}>
          Save draft
        </button>
        <Link to={drivePath("/market")} className="cars-btn cars-btn--outline">
          Browse the market
        </Link>
        <button
          type="button"
          className="cars-btn cars-btn--primary"
          disabled={!canContinue}
          onClick={() => navigate(drivePath("/compare"))}
        >
          Compare options
        </button>
      </div>
    </>
  );
}
