// Spec 028 on the LiveNear map: every surface renders in Bokmål and Turkish
// with no English UI text, raw keys or placeholders (R5, R13), and numbers
// follow the region's country in every language (R9, R10).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import type { RegionInfo, ZipValue } from "../api/client";
import AboutPanel from "../components/AboutPanel";
import ControlsPanel from "../components/ControlsPanel";
import ErrorBoundary from "../components/ErrorBoundary";
import GettingStarted from "../components/GettingStarted";
import Toasts from "../components/Toasts";
import WelcomeModal from "../components/WelcomeModal";
import ZipDetailPanel, { type ZipContext } from "../components/ZipDetailPanel";
import { METRICS } from "../config";
import { resetLanguage, setLanguage, t, type Lang } from "../i18n/core";
import { defaultBudgetSpec, type BudgetSpec } from "../lib/affordability";
import { departLabel, formatMonthYear, rangeLabel } from "../lib/format";
import { NO_LOCALE, US_LOCALE, metricsFor } from "../lib/locale";
import type { MatchResult } from "../lib/matches";
import { buildZipPopupHtml } from "../lib/popup";
import { englishLeftovers, rawKeys, useLanguage } from "./i18nHelpers";

const NBSP = " ";

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

afterEach(() => {
  cleanup();
  resetLanguage();
  vi.unstubAllGlobals();
});

const WA: RegionInfo = { code: "WA", name: "Washington", bbox: null, center: null, zip_count: 484 };
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

const US_REC: ZipValue = {
  zip: "98103",
  median_value: 937_500,
  yoy_pct: -2.5,
  cagr5_pct: 1.6,
  ppsf: 612,
  history: [
    ["2024-Q1", 890_000],
    ["2026-Q2", 937_500],
  ],
  population: 48_000,
  median_income: 112_000,
  price_to_income: 8.4,
  name: "Fremont",
};
const US_REC2: ZipValue = { ...US_REC, zip: "98105", median_value: 1_100_000, yoy_pct: 3.1, name: "Laurelhurst" };

const NO_REC: ZipValue = {
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
};

// Brand, source and place names stay as they are (R8); these are the
// fixtures' place names and the Zillow product name.
const ALLOW = [/Fremont|Laurelhurst|Washington|Grønland|Oslo/];

function expectClean(container: HTMLElement) {
  expect(englishLeftovers(container, ALLOW)).toEqual([]);
  expect(rawKeys(container)).toEqual([]);
}

function controls(country: "US" | "NO", budgetSpec: BudgetSpec, matches: MatchResult) {
  const region = country === "US" ? WA : OSLO;
  const locale = country === "US" ? US_LOCALE : NO_LOCALE;
  const metrics = metricsFor(region, locale, 75);
  const records = new Map<string, ZipValue>(
    country === "US" ? [["98103", US_REC], ["98105", US_REC2]] : [["03010102", NO_REC]],
  );
  return (
    <MemoryRouter>
      <ControlsPanel
        regions={[WA, OSLO]}
        state={region.code}
        onStateChange={() => {}}
        budget={800_000}
        budgetSpec={budgetSpec}
        onBudgetSpecChange={() => {}}
        asOf="2026-04-30"
        activeMetric={metrics[0]}
        stops={[
          { value: 450_000, color: "#eee" },
          { value: 900_000, color: "#999" },
        ]}
        metricKey="value"
        onMetricChange={() => {}}
        minutes={30}
        onMinutesChange={() => {}}
        variation={{ offpeak_sqmi: 400, typical_sqmi: 300, peak_sqmi: 250, peak_shrink_pct: 37.5 }}
        dual
        mode="drive"
        onModeChange={() => {}}
        onAddressLocated={() => {}}
        workAddress="1 Main St"
        work2Address={null}
        hasWork2
        onAddWork2={() => {}}
        onRemoveWork2={() => {}}
        searchTarget="A"
        onSearchTargetChange={() => {}}
        searchProximity={null}
        matches={matches}
        records={records}
        onZipChosen={() => {}}
        onShowIntro={() => {}}
        locale={locale}
        metrics={metrics}
        referenceM2={country === "NO" ? 75 : null}
        onReferenceM2Change={() => {}}
        firstRun={<GettingStarted budgetSet workSet={false} explored={false} onDone={() => {}} />}
      />
    </MemoryRouter>
  );
}

const HITS: MatchResult = {
  matches: [{ zip: "98103", name: "Fremont", median_value: 937_500, price_to_income: 8.4 }] as MatchResult["matches"],
  total: 1,
};

function context(): ZipContext {
  return {
    percentile: 82,
    vsStateMedianPct: 31.4,
    commuteReach: t("map.reach.driveWithin.typical", { minutes: 30 }),
    driveToWork: t("map.trip.drive.to.work", {
      range: rangeLabel(52, 60),
      window: t("map.trip.window", {
        start: departLabel("2026-06-15T08:00"),
        end: departLabel("2026-06-15T09:00").replace(/^\S+ /, ""),
      }),
    }),
    driveHome: t("map.trip.drive.home", { range: rangeLabel(64, 64), window: "" }),
    driveToWork2: null,
    driveHome2: null,
  };
}

function detail(country: "US" | "NO", pinned: string | null) {
  const us = country === "US";
  return (
    <ZipDetailPanel
      zip={us ? "98103" : "03010102"}
      record={us ? US_REC : NO_REC}
      metroLabel={us ? "Washington" : "Oslo & Akershus"}
      stateCode={us ? "WA" : "NO03"}
      budget={800_000}
      budgetSpec={{ ...defaultBudgetSpec(us ? "WA" : "NO03"), mode: "payment", payment: 3000 }}
      context={context()}
      estimating={false}
      wiki={us ? { extract: "Fremont is a neighborhood in Seattle.", thumbnailUrl: null, pageUrl: "https://en.wikipedia.org/wiki/Fremont" } : null}
      onClose={() => {}}
      pinnedZip={pinned}
      pinnedRecord={pinned ? (us ? US_REC2 : NO_REC) : undefined}
      onPin={() => {}}
      onUnpin={() => {}}
      locale={us ? US_LOCALE : NO_LOCALE}
      referenceM2={us ? null : 75}
    />
  );
}

for (const lang of ["nb", "tr"] as const) {
  describe(`LiveNear map in ${lang} (R5, R13)`, () => {
    beforeEach(async () => {
      await useLanguage(lang);
    });

    for (const country of ["US", "NO"] as const) {
      it(`controls panel, ${country}, price and payment budgets`, () => {
        const price = defaultBudgetSpec(country === "US" ? "WA" : "NO03");
        const a = render(controls(country, { ...price, price: 0 }, HITS));
        expectClean(a.container);
        a.unmount();
        const b = render(controls(country, { ...price, mode: "payment", payment: 3000 }, { matches: [], total: 0 }));
        expectClean(b.container);
      });

      it(`area detail and compare views, ${country}`, () => {
        const a = render(detail(country, null));
        expectClean(a.container);
        a.unmount();
        const b = render(detail(country, country === "US" ? "98105" : "03010102"));
        expectClean(b.container);
      });

      it(`popup, ${country}`, () => {
        const el = document.createElement("div");
        el.innerHTML =
          country === "US"
            ? buildZipPopupHtml("98103", US_REC, "WA") + buildZipPopupHtml("98109", undefined)
            : buildZipPopupHtml("0301", NO_REC, "NO03", NO_LOCALE) +
              buildZipPopupHtml("0302", undefined, "NO03", NO_LOCALE, null);
        expectClean(el);
      });
    }

    it("About dialog", () => {
      const { container } = render(<AboutPanel asOf="2026-04-30" onShowIntro={() => {}} />);
      fireEvent.click(screen.getByRole("button", { name: t("map.about.trigger") }));
      expectClean(container);
    });

    it("welcome modal with the budget field", () => {
      const { container } = render(
        <WelcomeModal
          onClose={() => {}}
          budgetSpec={{ ...defaultBudgetSpec("NO03"), mode: "payment" }}
          onBudgetChange={() => {}}
          locale={NO_LOCALE}
        />,
      );
      expectClean(container);
    });

    it("toasts, checklist done state and the crash screen", () => {
      const { container } = render(
        <>
          <Toasts messages={[t("map.notice.isochrone"), t("map.notice.regions", { code: "WA" })]} />
          <GettingStarted budgetSet workSet explored onDone={() => {}} />
        </>,
      );
      expectClean(container);

      const Boom = () => {
        throw new Error("boom");
      };
      vi.spyOn(console, "error").mockImplementation(() => {});
      const crash = render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );
      expectClean(crash.container);
    });

    it("metric labels and dates", () => {
      for (const m of METRICS) {
        expect(englishLeftovers(Object.assign(document.createElement("div"), { textContent: `${m.label} ${m.short}` }))).toEqual([]);
      }
      expect(formatMonthYear("2026-04-30")).toBe(lang === "nb" ? `apr.${NBSP}2026` : `Nis${NBSP}2026`);
      expect(departLabel("2026-06-15T17:30")).toBe(lang === "nb" ? "man. 17:30" : "Pzt 17:30");
    });
  });
}

describe("switching language re-renders the map panel (R3)", () => {
  it("relabels in place", async () => {
    render(controls("US", defaultBudgetSpec("WA"), HITS));
    expect(screen.getByText("Your matches")).toBeInTheDocument();
    await useLanguage("nb");
    expect(screen.getByText("Dine treff")).toBeInTheDocument();
    await act(() => setLanguage("en", false));
    expect(screen.getByText("Your matches")).toBeInTheDocument();
  });
});

describe("numbers follow the country, words the language (R9, R10)", () => {
  for (const lang of ["en", "nb", "tr"] as Lang[]) {
    it(`in ${lang}`, async () => {
      await act(() => setLanguage(lang, false));
      expect(NO_LOCALE.money(5_000_000)).toBe(`5${NBSP}000${NBSP}000 kr`);
      expect(US_LOCALE.money(5_000_000)).toBe("$5,000,000");
      expect(NO_LOCALE.perArea(98_381)).toBe(`98${NBSP}381 kr/m²`);
      expect(NO_LOCALE.count(45_000)).toBe(`45${NBSP}000`);
      expect(US_LOCALE.count(45_000)).toBe("45,000");
      const example = { en: "e.g.", nb: "f.eks.", tr: "örn." }[lang];
      expect(NO_LOCALE.budgetExample).toBe(`${example} 5${NBSP}000${NBSP}000`);
      expect(US_LOCALE.budgetExample).toBe(`${example} 800,000`);
      expect(NO_LOCALE.regionLabel).toBe({ en: "Fylke", nb: "Fylke", tr: "İl" }[lang]);
      expect(US_LOCALE.regionLabel).toBe({ en: "State", nb: "Delstat", tr: "Eyalet" }[lang]);
      expect(US_LOCALE.monthly(3180)).toBe(`$3,180${{ en: "/mo", nb: "/mnd", tr: "/ay" }[lang]}`);
    });
  }

  it("keeps English departure times byte-identical", () => {
    expect(departLabel("2026-06-15T08:00")).toBe("Mon 8:00 AM");
    expect(NO_LOCALE.departure("2026-07-15T16:45")).toBe("Wed 16:45");
  });
});
