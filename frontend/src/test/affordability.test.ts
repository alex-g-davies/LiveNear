import { describe, expect, it } from "vitest";

import {
  DEFAULT_BUDGET_SPEC,
  effectiveBudget,
  maxPriceForPayment,
  monthlyPaymentForPrice,
} from "../lib/affordability";

describe("affordability (020 R1)", () => {
  it("matches the hand-checked spec example: $3,000/mo, 20% down, 6.5% -> $476k", () => {
    // A = r / (1 - (1+r)^-360) with r = 0.065/12 = 0.0063205; 0.8·A + 0.015/12
    // = 0.0063064; 3000 / 0.0063064 = 475,706 -> nearest $1k.
    expect(maxPriceForPayment(3000, 20, 6.5)).toBe(476000);
  });

  it("uses the documented defaults when assumptions are omitted", () => {
    expect(maxPriceForPayment(3000)).toBe(maxPriceForPayment(3000, 20, 6.5));
  });

  it("amortizes linearly at a zero rate", () => {
    // 0.8 / 360 + 0.00125 = 0.0034722; 3000 / 0.0034722 = 864,000
    expect(maxPriceForPayment(3000, 20, 0)).toBe(864000);
  });

  it("treats a non-positive or invalid payment as no budget", () => {
    expect(maxPriceForPayment(0)).toBe(0);
    expect(maxPriceForPayment(-100)).toBe(0);
    expect(maxPriceForPayment(Number.NaN)).toBe(0);
  });

  it("more down or a lower rate raises the max price", () => {
    expect(maxPriceForPayment(3000, 40, 6.5)).toBeGreaterThan(maxPriceForPayment(3000, 20, 6.5));
    expect(maxPriceForPayment(3000, 20, 5)).toBeGreaterThan(maxPriceForPayment(3000, 20, 6.5));
  });

  it("clamps out-of-range assumptions instead of producing nonsense", () => {
    expect(maxPriceForPayment(3000, 150, 6.5)).toBe(maxPriceForPayment(3000, 99, 6.5));
    expect(maxPriceForPayment(3000, 20, -5)).toBe(maxPriceForPayment(3000, 20, 0));
  });

  it("round-trips price -> payment -> price within rounding", () => {
    const monthly = monthlyPaymentForPrice(600000, 20, 6.5);
    expect(monthly).toBe(3784); // 600000 · 0.0063064
    expect(maxPriceForPayment(monthly, 20, 6.5)).toBe(600000);
    expect(monthlyPaymentForPrice(0)).toBe(0);
  });

  it("effectiveBudget picks the typed price or the derived one by mode", () => {
    expect(effectiveBudget({ ...DEFAULT_BUDGET_SPEC, price: 550000 })).toBe(550000);
    expect(effectiveBudget({ ...DEFAULT_BUDGET_SPEC, mode: "payment", payment: 3000 })).toBe(
      476000,
    );
    expect(effectiveBudget({ ...DEFAULT_BUDGET_SPEC, mode: "payment", payment: 0 })).toBe(0);
  });
});
