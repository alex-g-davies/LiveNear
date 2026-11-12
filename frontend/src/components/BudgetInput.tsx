import type { ChangeEvent } from "react";

import { MORTGAGE_TERM_YEARS, TAX_INSURANCE_PCT } from "../config";
import { type BudgetMode, type BudgetSpec, maxPriceForPayment } from "../lib/affordability";
import { useT } from "../i18n/react";
import { type Locale, US_LOCALE } from "../lib/locale";
import { rich } from "../lib/rich";

interface Props {
  spec: BudgetSpec;
  onChange: (spec: BudgetSpec) => void;
  /** Overrides the "Budget" label (the welcome modal asks a fuller question). */
  label?: string;
  /** Muted nudge under the field, shown only while no budget is set. */
  hint?: string;
  locale?: Locale;
}

// Short enough to sit side by side in the 240 px panel without ellipsis;
// the "/mo" unit on the field below completes "Monthly".
const MODES: BudgetMode[] = ["price", "payment"];

/** Digits only -> number; empty -> 0 (015 R2 semantics, shared by both modes). */
function parseDollars(raw: string): number {
  const digits = raw.replace(/[^0-9]/g, "");
  return digits === "" ? 0 : Number(digits);
}

/** Percent field -> number clamped to [lo, hi]; empty/invalid -> lo. */
function parsePct(raw: string, lo: number, hi: number): number {
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Budget control (R4, 015 R2, 020 R2). Price mode is the classic dollar
 * input; payment mode takes a monthly payment plus down-payment and rate
 * assumptions and shows the max price they support — which is what every
 * downstream consumer receives as "the budget".
 */
export default function BudgetInput({ spec, onChange, label, hint, locale = US_LOCALE }: Props) {
  const { t } = useT();
  // Separators while typing, empty for 0 (015 R2), in the country's style.
  const display = (value: number) => (value > 0 ? locale.count(value) : "");
  const setPrice = (e: ChangeEvent<HTMLInputElement>) =>
    onChange({ ...spec, price: parseDollars(e.target.value) });
  const setPayment = (e: ChangeEvent<HTMLInputElement>) =>
    onChange({ ...spec, payment: parseDollars(e.target.value) });
  const setDown = (e: ChangeEvent<HTMLInputElement>) =>
    onChange({ ...spec, downPct: parsePct(e.target.value, 0, 99) });
  const setRate = (e: ChangeEvent<HTMLInputElement>) =>
    onChange({ ...spec, ratePct: parsePct(e.target.value, 0, 30) });

  const derived = maxPriceForPayment(spec.payment, spec.downPct, spec.ratePct, spec.taxPct);
  const taxPct = spec.taxPct ?? TAX_INSURANCE_PCT;
  const unset = spec.mode === "price" ? spec.price === 0 : spec.payment === 0;

  return (
    <div className="budget-input">
      <span className="budget-input__label">{label ?? t("map.budget.label")}</span>
      <div className="switcher switcher--tight" role="group" aria-label={t("map.budget.modeGroup")}>
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            className={m === spec.mode ? "switcher__btn switcher__btn--active" : "switcher__btn"}
            aria-pressed={m === spec.mode}
            title={t(`map.budget.mode.${m}.title`)}
            onClick={() => onChange({ ...spec, mode: m })}
          >
            {t(`map.budget.mode.${m}`)}
          </button>
        ))}
      </div>

      {spec.mode === "price" ? (
        <label className="budget-input__field">
          <span aria-hidden="true">{locale.currencySymbol}</span>
          <input
            type="text"
            inputMode="numeric"
            aria-label={t("map.budget.priceInput", { currency: locale.currencyName })}
            placeholder={locale.budgetExample}
            value={display(spec.price)}
            onChange={setPrice}
          />
        </label>
      ) : (
        <>
          <label className="budget-input__field">
            <span aria-hidden="true">{locale.currencySymbol}</span>
            <input
              type="text"
              inputMode="numeric"
              aria-label={t("map.budget.paymentInput", { currency: locale.currencyName })}
              placeholder={locale.paymentExample}
              value={display(spec.payment)}
              onChange={setPayment}
            />
            <span className="budget-input__unit" aria-hidden="true">
              {t("map.unit.perMonthShort")}
            </span>
          </label>
          <div className="budget-input__assumptions">
            <label className="budget-input__assumption">
              <span>{t("map.budget.down")}</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={99}
                step={1}
                aria-label={t("map.budget.downInput")}
                value={spec.downPct}
                onChange={setDown}
              />
              <span aria-hidden="true">%</span>
            </label>
            <label className="budget-input__assumption">
              <span>{t("map.budget.rate")}</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={30}
                step={0.1}
                aria-label={t("map.budget.rateInput")}
                value={spec.ratePct}
                onChange={setRate}
              />
              <span aria-hidden="true">%</span>
            </label>
          </div>
          <p className="budget-input__derived" aria-live="polite">
            {derived > 0 ? (
              rich(t("map.budget.maxPrice"), { price: <strong>{locale.money(derived)}</strong> })
            ) : (
              t("map.budget.enterPayment")
            )}
            <span className="budget-input__assumes">
              {" "}
              ·{" "}
              {t("map.budget.assumes", {
                years: MORTGAGE_TERM_YEARS,
                pct: locale.decimal(String(taxPct)),
              })}
            </span>
          </p>
          {locale.country === "NO" && (
            <p className="budget-input__assumes">
              {t("map.budget.noRules", { equity: 10, debt: 5, rise: 3, floor: 7 })}
            </p>
          )}
        </>
      )}
      {hint && unset && <span className="budget-input__hint">{hint}</span>}
    </div>
  );
}
