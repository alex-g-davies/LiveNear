// Norway in the frontend (spec 026 R8-R11, R15-R18).

import { fireEvent, render, screen } from "@testing-library/react";
import type { FeatureCollection } from "geojson";
import { describe, expect, it, vi } from "vitest";

import type { RegionInfo, ZipValue } from "../api/client";
import BudgetInput from "../components/BudgetInput";
import CommuteControl from "../components/CommuteControl";
import ReferenceSize from "../components/ReferenceSize";
import RegionPicker from "../components/RegionPicker";
import { defaultBudgetSpec, effectiveBudget } from "../lib/affordability";
import { computeMatches } from "../lib/matches";
import { NO_LOCALE, US_LOCALE, localeFor, metricsFor } from "../lib/locale";
import { buildZipPopupHtml } from "../lib/popup";
import { applyReferenceSize, applyReferenceSizeToGeojson } from "../lib/referenceSize";
import { budgetSpecFromUrl, parseAppUrl, serializeAppUrl } from "../lib/urlState";

const OSLO: RegionInfo = {
  code: "NO03",
  name: "Oslo & Akershus",
  bbox: null,
  center: null,
  zip_count: 119,
  country: "NO",
  currency: "NOK",
  region_label: "Fylke",
  metrics: ["value", "ppsf", "afford"],
  reference_m2: 75,
};

function record(over: Partial<ZipValue>): ZipValue {
  return {
    zip: "03010102",
    median_value: 7_500_000,
    yoy_pct: null,
    cagr5_pct: null,
    ppsf: null,
    history: null,
    population: null,
    median_income: 500_000,
    price_to_income: 15,
    name: "Grønland",
    price_per_m2: 100_000,
    sales: 335,
    area_type: "Delbydel",
    income_level: "bydel",
    ...over,
  };
}

// Norwegian number style (028 R10): no-break-space groups, decimal comma.
describe("locale (026 R15)", () => {
  it("shows kroner, metric units and a 24-hour clock in Norway", () => {
    expect(NO_LOCALE.money(5_250_000)).toBe("5\u00a0250\u00a0000 kr");
    expect(NO_LOCALE.moneyCompact(5_250_000)).toBe("5,3M kr");
    expect(NO_LOCALE.perArea(98_381)).toBe("98\u00a0381 kr/m²");
    expect(NO_LOCALE.reachArea(100)).toBe("259 km²");
    expect(NO_LOCALE.departure("2026-07-15T16:45")).toBe("Wed 16:45");
  });

  it("keeps US formatting for regions without a descriptor", () => {
    const wa: RegionInfo = { code: "WA", name: "Washington", bbox: null, center: null, zip_count: 484 };
    expect(localeFor(wa, "WA")).toBe(US_LOCALE);
    expect(US_LOCALE.departure("2026-07-15T16:45")).toBe("Wed 4:45 PM");
  });

  it("knows a Norwegian link before the region list arrives", () => {
    expect(localeFor(null, "NO46")).toBe(NO_LOCALE);
  });
});

describe("metrics (026 R9, R10, R11)", () => {
  it("offers only what Norway has, with no trend metric", () => {
    const metrics = metricsFor(OSLO, NO_LOCALE, 75);
    expect(metrics.map((m) => m.key)).toEqual(["value", "ppsf", "afford"]);
    expect(metrics[0].label).toBe("Estimated price (75 m²)");
    expect(metrics[1].property).toBe("price_per_m2");
  });

  it("leaves the US metric list alone", () => {
    expect(metricsFor(null, US_LOCALE, 75).map((m) => m.key)).toEqual([
      "value",
      "yoy",
      "ppsf",
      "afford",
    ]);
  });
});

describe("reference size (026 R9, R18)", () => {
  const records = new Map([["03010102", record({})]]);

  it("recomputes the estimate and ratio from price per m²", () => {
    const sized = applyReferenceSize(records, 100).get("03010102");
    expect(sized?.median_value).toBe(10_000_000);
    expect(sized?.price_to_income).toBe(20);
  });

  it("has no ratio without income", () => {
    const noIncome = new Map([["3201", record({ median_income: null, price_to_income: null })]]);
    expect(applyReferenceSize(noIncome, 100).get("3201")?.price_to_income).toBeNull();
  });

  it("does not touch US records", () => {
    const us = new Map([["98101", record({ zip: "98101", price_per_m2: null })]]);
    expect(applyReferenceSize(us, 100)).toBe(us);
  });

  it("carries estimates onto the map and leaves no-data areas empty", () => {
    const sized = applyReferenceSize(records, 100);
    const geo: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { zip: "03010102" }, geometry: null as never },
        { type: "Feature", properties: { zip: "03011701" }, geometry: null as never },
      ],
    };
    const out = applyReferenceSizeToGeojson(geo, sized);
    expect(out?.features[0].properties?.median_value).toBe(10_000_000);
    expect(out?.features[1].properties?.median_value).toBeUndefined();
  });

  it("matches on the estimate at the chosen size", () => {
    const sized = applyReferenceSize(records, 100);
    const centroids = new Map([["03010102", [0, 0] as [number, number]]]);
    const iso: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { scenario: "typical" },
          geometry: {
            type: "Polygon",
            coordinates: [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]],
          },
        },
      ],
    };
    expect(computeMatches(sized, centroids, iso, 9_000_000).total).toBe(0);
    expect(computeMatches(sized, centroids, iso, 11_000_000).total).toBe(1);
  });

  it("lets a user type a size without intermediate values applying", () => {
    const onChange = vi.fn();
    render(<ReferenceSize value={75} onChange={onChange} />);
    const input = screen.getByLabelText(/Home size/);
    fireEvent.change(input, { target: { value: "1" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "120" } });
    expect(onChange).toHaveBeenCalledWith(120);
  });
});

describe("URLs and budgets (026 R8, R16, R17)", () => {
  const base = {
    zip: null,
    budget: defaultBudgetSpec("NO03"),
    work: { lat: 59.9, lon: 10.7 },
    work2: null,
    minutes: 30,
    metric: "value" as const,
    tmode: "drive" as const,
  };

  it("round-trips Norwegian regions and both ID lengths", () => {
    for (const zip of ["0301", "03010102"]) {
      const qs = serializeAppUrl({ ...base, state: "NO03", zip });
      expect(parseAppUrl(qs)).toMatchObject({ state: "NO03", zip });
    }
  });

  it("keeps US ZIPs exactly five digits", () => {
    expect(parseAppUrl("?state=WA&zip=0301").zip).toBeUndefined();
    expect(parseAppUrl("?zip=02139").zip).toBe("02139");
  });

  it("round-trips a changed reference size and drops invalid ones", () => {
    const qs = serializeAppUrl({ ...base, state: "NO03", m2: 120 });
    expect(parseAppUrl(qs).m2).toBe(120);
    expect(parseAppUrl("?state=NO03&m2=5").m2).toBeUndefined();
  });

  it("reads a budget on a Norwegian link with Norwegian defaults", () => {
    const spec = budgetSpecFromUrl(parseAppUrl("?state=NO03&pay=30000"));
    expect(spec.payment).toBe(30_000);
    expect(spec.downPct).toBe(10);
    expect(spec.taxPct).toBe(0.5);
    expect(effectiveBudget(spec)).toBeGreaterThan(0);
  });

  it("omits Norwegian defaults from the URL", () => {
    const qs = serializeAppUrl({
      ...base,
      state: "NO03",
      budget: { ...defaultBudgetSpec("NO03"), mode: "payment", payment: 30_000 },
    });
    expect(qs).not.toContain("down=");
    expect(qs).not.toContain("rate=");
  });
});

describe("presentation (026 R3, R14, R15, R17)", () => {
  it("says payment mode does not check the lending limits", () => {
    render(
      <BudgetInput
        spec={{ ...defaultBudgetSpec("NO03"), mode: "payment", payment: 30_000 }}
        onChange={() => {}}
        locale={NO_LOCALE}
      />,
    );
    expect(screen.getByText(/doesn’t check those limits/)).toBeInTheDocument();
    expect(screen.getByLabelText("Monthly payment in kroner")).toBeInTheDocument();
  });

  it("notes ferries for Norwegian commutes only", () => {
    const props = {
      minutes: 30,
      onMinutesChange: () => {},
      variation: null,
      dual: false,
      mode: "drive" as const,
      onModeChange: () => {},
    };
    const { rerender } = render(<CommuteControl {...props} locale={NO_LOCALE} />);
    expect(screen.getByText(/can include ferries/)).toBeInTheDocument();
    rerender(<CommuteControl {...props} />);
    expect(screen.queryByText(/can include ferries/)).toBeNull();
  });

  it("explains a no-data area by name", () => {
    const html = buildZipPopupHtml("3201", undefined, "NO03", NO_LOCALE, "Bærum");
    expect(html).toContain("Bærum");
    expect(html).toContain("Under 10 sales");
    expect(html).not.toContain("ZIP");
  });

  it("groups the picker by country and uses local wording", () => {
    const wa: RegionInfo = { code: "WA", name: "Washington", bbox: null, center: null, zip_count: 484 };
    render(<RegionPicker regions={[wa, OSLO]} state="NO03" onStateChange={() => {}} />);
    expect(screen.getByLabelText("Fylke")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Oslo & Akershus · 119 areas" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Norway" })).toBeInTheDocument();
  });
});
