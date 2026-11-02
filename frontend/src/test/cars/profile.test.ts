import "./localStoragePolyfill";

import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_PROFILE,
  DEFAULT_STATE,
  STORAGE_KEY,
  decodeState,
  encodeState,
  exitOddsSum,
  loadState,
  mostLikelyExit,
  saveState,
  type CarState,
} from "../../cars/lib/profile";

const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("profile codec (spec 022 R2)", () => {
  beforeEach(() => window.localStorage.clear());

  it("encodes an all-default state as an empty token and decodes it back", () => {
    expect(encodeState(DEFAULT_STATE)).toBe("");
    expect(decodeState("")).toEqual(DEFAULT_STATE);
    expect(decodeState(null)).toEqual(DEFAULT_STATE);
  });

  it("round-trips a customised state with defaults omitted", () => {
    const state: CarState = {
      profile: {
        ...DEFAULT_PROFILE,
        exit_odds: { p12: 10, p24: 20, p36: 30, p48: 40 },
        km_per_year: 18_000,
        municipality: "Bærum",
        pay_mode: "cash",
        insurance: { age_band: "25-29", claims_free_years: 3, has_claims_free_letter: true },
        limits: { max_price_nok: 450_000, need_by: "2027-01-15", must_haves: ["heat_pump"], modes: ["new", "lease"] },
      },
      selection: [{ variant_id: "tesla-model3-lr-rwd", year_from: 2023, year_to: 2026 }],
      whatIf: { km_per_year: 20_000, pay_mode: "loan" },
      overrides: { purchase_price: 399_000 },
      measure: "tco",
      checklist: ["claims_free_letter", "licence_exchange"],
    };
    state.profile.toll_passages_per_week = 10;
    const token = encodeState(state);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeState(token)).toEqual(state);
    // Defaults are omitted: the token must not mention untouched fields.
    const json = atob(token.replace(/-/g, "+").replace(/_/g, "/"));
    expect(json).not.toContain("charging_mix");
    expect(json).not.toContain("fun_weight");
  });

  it("falls back to defaults on garbage tokens", () => {
    expect(decodeState("!!!not base64!!!")).toEqual(DEFAULT_STATE);
    expect(decodeState(b64url("not json"))).toEqual(DEFAULT_STATE);
    expect(decodeState(b64url("[1,2,3]"))).toEqual(DEFAULT_STATE);
    expect(decodeState(b64url('"string"'))).toEqual(DEFAULT_STATE);
  });

  it("drops invalid fields individually and keeps the valid ones", () => {
    const token = b64url(
      JSON.stringify({
        profile: {
          km_per_year: "lots",
          pay_mode: "crypto",
          exit_odds: { p12: 50, p24: "x", p36: 250 },
          limits: { modes: ["new", "teleport"], must_haves: "awd", max_price_nok: -5 },
          insurance: { age_band: "12-17", claims_free_years: 4 },
          toll_passages_per_week: 7.6,
        },
        selection: [{ variant_id: 1 }, { variant_id: "ok", year_from: 2024, year_to: 2022 }, { variant_id: "fine", year_from: 2022, year_to: 2024 }],
        whatIf: { loan_rate_pct: "7", km_per_year: 15000, pay_mode: "both" },
        overrides: { purchase_price: 400000, bad: { nested: true } },
        measure: "nope",
      }),
    );
    const s = decodeState(token);
    expect(s.profile.km_per_year).toBe(DEFAULT_PROFILE.km_per_year);
    expect(s.profile.pay_mode).toBe("loan");
    expect(s.profile.exit_odds).toEqual({ p12: 50, p24: 35, p36: 35, p48: 15 });
    expect(s.profile.limits.modes).toEqual(["new"]);
    expect(s.profile.limits.must_haves).toEqual([]);
    expect(s.profile.limits.max_price_nok).toBeNull();
    expect(s.profile.insurance).toEqual({ age_band: "30-39", claims_free_years: 4, has_claims_free_letter: false });
    expect(s.selection).toEqual([{ variant_id: "fine", year_from: 2022, year_to: 2024 }]);
    expect(s.whatIf).toEqual({ km_per_year: 15000 });
    expect(s.overrides).toEqual({ purchase_price: 400000 });
    expect(s.measure).toBe("per_month");
    expect(s.profile.toll_passages_per_week).toBe(8);
  });

  it("drops out-of-range toll passages and keeps the default (024 R5)", () => {
    const token = b64url(JSON.stringify({ profile: { toll_passages_per_week: 999 } }));
    expect(decodeState(token).profile.toll_passages_per_week).toBe(0);
    const neg = b64url(JSON.stringify({ profile: { toll_passages_per_week: -3 } }));
    expect(decodeState(neg).profile.toll_passages_per_week).toBe(0);
  });

  it("persists to and restores from localStorage, tolerating junk", () => {
    expect(loadState()).toBeNull();
    const state: CarState = { ...DEFAULT_STATE, measure: "per_km" };
    expect(saveState(state)).toBe(true);
    expect(loadState()).toEqual(state);
    window.localStorage.setItem(STORAGE_KEY, "{broken");
    expect(loadState()).toBeNull();
  });

  it("helpers: odds sum and most likely exit", () => {
    expect(exitOddsSum(DEFAULT_PROFILE.exit_odds)).toBe(100);
    expect(mostLikelyExit(DEFAULT_PROFILE.exit_odds)).toBe("p24");
    expect(mostLikelyExit({ p12: 5, p24: 5, p36: 10, p48: 80 })).toBe("p48");
  });
});
