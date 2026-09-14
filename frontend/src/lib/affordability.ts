// Monthly-payment <-> max-price conversion (spec 020 R1). Pure math, no
// React: the budget control and the detail panel both consume it, and the
// unit tests pin the hand-checked values in the spec.

import {
  DEFAULT_DOWN_PCT,
  DEFAULT_RATE_PCT,
  MORTGAGE_TERM_YEARS,
  TAX_INSURANCE_PCT,
} from "../config";

/** How the user states their budget: a sticker price, or a monthly payment
 * plus the assumptions that turn it into one. */
export type BudgetMode = "price" | "payment";

export interface BudgetSpec {
  mode: BudgetMode;
  /** Typed purchase price (price mode); 0 = no budget. */
  price: number;
  /** Typed monthly payment (payment mode); 0 = no budget. */
  payment: number;
  /** Down payment as a percent of price, 0–99. */
  downPct: number;
  /** Annual interest rate in percent, 0–30. */
  ratePct: number;
}

export const DEFAULT_BUDGET_SPEC: BudgetSpec = {
  mode: "price",
  price: 0,
  payment: 0,
  downPct: DEFAULT_DOWN_PCT,
  ratePct: DEFAULT_RATE_PCT,
};

/** Monthly cost of each $1 of price: financed-fraction × amortization factor
 * plus the tax + insurance allowance. Zero-rate loans amortize linearly. */
function monthlyFactorPerDollar(downPct: number, ratePct: number): number {
  const financed = 1 - clamp(downPct, 0, 99) / 100;
  const n = MORTGAGE_TERM_YEARS * 12;
  const r = clamp(ratePct, 0, 30) / 100 / 12;
  const amortization = r === 0 ? 1 / n : r / (1 - (1 + r) ** -n);
  return financed * amortization + TAX_INSURANCE_PCT / 100 / 12;
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

/** Maximum purchase price a monthly payment supports, rounded to the nearest
 * $1,000. Non-positive payments mean "no budget" and return 0. */
export function maxPriceForPayment(
  payment: number,
  downPct: number = DEFAULT_DOWN_PCT,
  ratePct: number = DEFAULT_RATE_PCT,
): number {
  if (!Number.isFinite(payment) || payment <= 0) return 0;
  const price = payment / monthlyFactorPerDollar(downPct, ratePct);
  return Math.round(price / 1000) * 1000;
}

/** Estimated all-in monthly payment for a purchase price under the same
 * assumptions (the display inverse of maxPriceForPayment), whole dollars. */
export function monthlyPaymentForPrice(
  price: number,
  downPct: number = DEFAULT_DOWN_PCT,
  ratePct: number = DEFAULT_RATE_PCT,
): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  return Math.round(price * monthlyFactorPerDollar(downPct, ratePct));
}

/** The dollar budget every existing consumer (opacity, hatch, matches,
 * badge) receives: the typed price, or the price the payment supports. */
export function effectiveBudget(spec: BudgetSpec): number {
  return spec.mode === "payment"
    ? maxPriceForPayment(spec.payment, spec.downPct, spec.ratePct)
    : spec.price;
}
