import { describe, expect, it } from "vitest";

import { DEFAULT_BUDGET_SPEC } from "../lib/affordability";
import { budgetSpecFromUrl, parseAppUrl, serializeAppUrl } from "../lib/urlState";
import { DEFAULT_MINUTES, DEFAULT_WORK } from "../config";

const DEFAULTS = {
  state: "WA",
  zip: null,
  budget: DEFAULT_BUDGET_SPEC,
  work: DEFAULT_WORK,
  work2: null,
  minutes: DEFAULT_MINUTES,
  metric: "value" as const,
  tmode: "drive" as const,
};

describe("urlState (009 R5)", () => {
  it("round-trips a full state", () => {
    const input = {
      state: "CO",
      zip: "80302",
      budget: { ...DEFAULT_BUDGET_SPEC, price: 600000 },
      work: { lat: 39.7392, lon: -104.9903 },
      work2: { lat: 39.9, lon: -105.1 },
      minutes: 45,
      metric: "yoy" as const,
      tmode: "walk" as const,
    };
    const qs = serializeAppUrl(input);
    const parsed = parseAppUrl(qs);
    expect(parsed.state).toBe("CO");
    expect(parsed.zip).toBe("80302");
    expect(parsed.budget).toBe(600000);
    expect(parsed.work).toEqual({ lat: 39.7392, lon: -104.9903 });
    expect(parsed.minutes).toBe(45);
    expect(parsed.metric).toBe("yoy");
    expect(parsed.tmode).toBe("walk");
    expect(parsed.work2).toEqual({ lat: 39.9, lon: -105.1 });
  });

  it("requires lat2 and lon2 together (016 R6)", () => {
    expect(parseAppUrl("?lat2=39.9").work2).toBeUndefined();
    expect(parseAppUrl("?lon2=-105.1").work2).toBeUndefined();
  });

  it("serializes defaults to an empty string", () => {
    expect(serializeAppUrl(DEFAULTS)).toBe("");
  });

  it("drops invalid params silently", () => {
    const parsed = parseAppUrl(
      "?state=Colorado&zip=1234&budget=-5&lat=99&lon=-104&min=37&metric=bogus&pay=0&down=120&rate=abc",
    );
    expect(parsed).toEqual({});
  });

  it("requires lat and lon together", () => {
    expect(parseAppUrl("?lat=39.7").work).toBeUndefined();
    expect(parseAppUrl("?lon=-104.9").work).toBeUndefined();
  });

  it("normalizes state case", () => {
    expect(parseAppUrl("?state=co").state).toBe("CO");
  });

  it("round-trips the affordability metric (014 R3)", () => {
    expect(parseAppUrl("?metric=afford").metric).toBe("afford");
    expect(serializeAppUrl({ ...DEFAULTS, metric: "afford" })).toBe("?metric=afford");
  });

  it("round-trips travel mode, omitting the drive default (013 R5)", () => {
    expect(parseAppUrl("?tmode=cycle").tmode).toBe("cycle");
    expect(parseAppUrl("?tmode=jetpack").tmode).toBeUndefined();
    expect(serializeAppUrl({ ...DEFAULTS, tmode: "walk" })).toBe("?tmode=walk");
    expect(serializeAppUrl(DEFAULTS)).toBe("");
  });

  it("keeps leading-zero ZIPs", () => {
    expect(parseAppUrl("?zip=05001").zip).toBe("05001");
  });
});

describe("urlState payment-mode budget (020 R3)", () => {
  it("serializes payment mode as pay, with assumptions only when non-default", () => {
    const spec = { ...DEFAULT_BUDGET_SPEC, mode: "payment" as const, payment: 3000 };
    expect(serializeAppUrl({ ...DEFAULTS, budget: spec })).toBe("?pay=3000");
    expect(serializeAppUrl({ ...DEFAULTS, budget: { ...spec, downPct: 10, ratePct: 7 } })).toBe(
      "?pay=3000&down=10&rate=7",
    );
  });

  it("uses only the active mode's value, so a stale price never leaks", () => {
    const both = { ...DEFAULT_BUDGET_SPEC, price: 800000, payment: 3000 };
    expect(serializeAppUrl({ ...DEFAULTS, budget: both })).toBe("?budget=800000");
    expect(serializeAppUrl({ ...DEFAULTS, budget: { ...both, mode: "payment" } })).toBe(
      "?pay=3000",
    );
    // Payment mode with nothing typed is not a shareable budget.
    expect(
      serializeAppUrl({ ...DEFAULTS, budget: { ...both, mode: "payment", payment: 0 } }),
    ).toBe("");
  });

  it("parses pay/down/rate within range and opens payment mode", () => {
    const parsed = parseAppUrl("?pay=3000&down=10&rate=7");
    expect(parsed).toEqual({ pay: 3000, down: 10, rate: 7 });
    expect(budgetSpecFromUrl(parsed)).toEqual({
      mode: "payment",
      price: 0,
      payment: 3000,
      downPct: 10,
      ratePct: 7,
    });
  });

  it("falls back to price mode and defaults without pay", () => {
    expect(budgetSpecFromUrl(parseAppUrl("?budget=600000"))).toEqual({
      ...DEFAULT_BUDGET_SPEC,
      price: 600000,
    });
    expect(budgetSpecFromUrl(parseAppUrl(""))).toEqual(DEFAULT_BUDGET_SPEC);
    // Assumptions alone don't switch modes but are kept for when the user does.
    expect(budgetSpecFromUrl(parseAppUrl("?rate=5"))).toEqual({ ...DEFAULT_BUDGET_SPEC, ratePct: 5 });
  });
});
