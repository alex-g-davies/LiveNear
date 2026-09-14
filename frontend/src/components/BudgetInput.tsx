import type { ChangeEvent } from "react";

import { MORTGAGE_TERM_YEARS, TAX_INSURANCE_PCT } from "../config";
import { type BudgetMode, type BudgetSpec, maxPriceForPayment } from "../lib/affordability";
import { formatBudgetInput, formatUsd } from "../lib/format";

interface Props {
  spec: BudgetSpec;
  onChange: (spec: BudgetSpec) => void;
}

// Short enough to sit side by side in the 240 px panel without ellipsis;
// the "/mo" unit on the field below completes "Monthly".
const MODES: { key: BudgetMode; label: string; title: string }[] = [
  { key: "price", label: "Home price", title: "Budget as a purchase price" },
  { key: "payment", label: "Monthly", title: "Budget as a monthly payment" },
];

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
export default function BudgetInput({ spec, onChange }: Props) {
  const setPrice = (e: ChangeEvent<HTMLInputElement>) =>
    onChange({ ...spec, price: parseDollars(e.target.value) });
  const setPayment = (e: ChangeEvent<HTMLInputElement>) =>
    onChange({ ...spec, payment: parseDollars(e.target.value) });
  const setDown = (e: ChangeEvent<HTMLInputElement>) =>
    onChange({ ...spec, downPct: parsePct(e.target.value, 0, 99) });
  const setRate = (e: ChangeEvent<HTMLInputElement>) =>
    onChange({ ...spec, ratePct: parsePct(e.target.value, 0, 30) });

  const derived = maxPriceForPayment(spec.payment, spec.downPct, spec.ratePct);

  return (
    <div className="budget-input">
      <span className="budget-input__label">Budget</span>
      <div className="switcher switcher--tight" role="group" aria-label="Budget as">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            className={m.key === spec.mode ? "switcher__btn switcher__btn--active" : "switcher__btn"}
            aria-pressed={m.key === spec.mode}
            title={m.title}
            onClick={() => onChange({ ...spec, mode: m.key })}
          >
            {m.label}
          </button>
        ))}
      </div>

      {spec.mode === "price" ? (
        <label className="budget-input__field">
          <span aria-hidden="true">$</span>
          <input
            type="text"
            inputMode="numeric"
            aria-label="Budget in dollars"
            placeholder="e.g. 800,000"
            value={formatBudgetInput(spec.price)}
            onChange={setPrice}
          />
        </label>
      ) : (
        <>
          <label className="budget-input__field">
            <span aria-hidden="true">$</span>
            <input
              type="text"
              inputMode="numeric"
              aria-label="Monthly payment in dollars"
              placeholder="e.g. 3,000"
              value={formatBudgetInput(spec.payment)}
              onChange={setPayment}
            />
            <span className="budget-input__unit" aria-hidden="true">
              /mo
            </span>
          </label>
          <div className="budget-input__assumptions">
            <label className="budget-input__assumption">
              <span>Down</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={99}
                step={1}
                aria-label="Down payment percent"
                value={spec.downPct}
                onChange={setDown}
              />
              <span aria-hidden="true">%</span>
            </label>
            <label className="budget-input__assumption">
              <span>Rate</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={30}
                step={0.1}
                aria-label="Interest rate percent"
                value={spec.ratePct}
                onChange={setRate}
              />
              <span aria-hidden="true">%</span>
            </label>
          </div>
          <p className="budget-input__derived" aria-live="polite">
            {derived > 0 ? (
              <>
                ≈ max price <strong>{formatUsd(derived)}</strong>
              </>
            ) : (
              "Enter a monthly payment to set a budget"
            )}
            <span className="budget-input__assumes">
              {" "}
              · assumes {MORTGAGE_TERM_YEARS}-yr, {TAX_INSURANCE_PCT}%/yr tax + insurance
            </span>
          </p>
        </>
      )}
    </div>
  );
}
