// How a region presents numbers and places (spec 026 R7, R10, R15). A region
// without a descriptor is treated as US, so existing data needs no changes.

import type { RegionInfo } from "../api/client";
import { METRICS, type MetricDef } from "../config";
import {
  departLabel,
  formatMonthly,
  formatPpsf,
  formatSqMi,
  formatUsd,
  formatUsdCompact,
  placeLabel,
} from "./format";

export interface Locale {
  country: string;
  currencySymbol: string;
  /** Plural currency word for labels, e.g. "Budget in kroner". */
  currencyName: string;
  budgetExample: string;
  paymentExample: string;
  money: (value: number) => string;
  moneyCompact: (value: number) => string;
  monthly: (value: number) => string;
  /** Price per unit of floor area. */
  perArea: (value: number) => string;
  /** Reach area, given in square miles as the backend reports it. */
  reachArea: (sqmi: number | null | undefined) => string;
  departure: (iso: string) => string;
  place: (id: string, name: string | null | undefined, regionCode?: string | null) => string;
  /** "State" / "Fylke". */
  regionLabel: string;
  /** Singular noun for a map area in running text. */
  areaNoun: string;
  areaPlural: string;
}

export const US_LOCALE: Locale = {
  country: "US",
  currencySymbol: "$",
  currencyName: "dollars",
  budgetExample: "e.g. 800,000",
  paymentExample: "e.g. 3,000",
  money: formatUsd,
  moneyCompact: formatUsdCompact,
  monthly: formatMonthly,
  perArea: formatPpsf,
  reachArea: formatSqMi,
  departure: (iso) => departLabel(iso),
  place: placeLabel,
  regionLabel: "State",
  areaNoun: "ZIP",
  areaPlural: "ZIPs",
};

const SQ_KM_PER_SQ_MI = 2.589988;

function kroner(value: number): string {
  return `${Math.round(value).toLocaleString("en-US")} kr`;
}

function kronerCompact(value: number): string {
  return value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1)}M kr`
    : `${Math.round(value / 1000)}k kr`;
}

export const NO_LOCALE: Locale = {
  country: "NO",
  currencySymbol: "kr",
  currencyName: "kroner",
  budgetExample: "e.g. 5,000,000",
  paymentExample: "e.g. 30,000",
  money: kroner,
  moneyCompact: kronerCompact,
  monthly: (value) => `${kroner(value)}/mo`,
  perArea: (value) => `${kroner(value)}/m²`,
  reachArea: (sqmi) => (sqmi == null ? "—" : `${Math.round(sqmi * SQ_KM_PER_SQ_MI)} km²`),
  departure: (iso) => departLabel(iso, true),
  place: (id, name) => name ?? `Area ${id}`,
  regionLabel: "Fylke",
  areaNoun: "area",
  areaPlural: "areas",
};

/** The region's locale. Before the region list arrives the code alone decides,
 * so a shared Norwegian link never flashes dollars. */
export function localeFor(region: RegionInfo | null, code: string): Locale {
  const country = region?.country ?? (isNorwegianCode(code) ? "NO" : "US");
  return country === "NO" ? NO_LOCALE : US_LOCALE;
}

export function isNorwegianCode(code: string): boolean {
  return /^NO\d{2}$/.test(code);
}

/** The metrics a region can show, labelled for its units (026 R9, R10). */
export function metricsFor(
  region: RegionInfo | null,
  locale: Locale,
  referenceM2: number,
): MetricDef[] {
  const allowed = region?.metrics ?? (locale.country === "NO" ? ["value", "ppsf", "afford"] : null);
  const available = METRICS.filter((m) => !allowed || allowed.includes(m.key));
  if (locale.country !== "NO") return available;
  return available.map((m) => {
    if (m.key === "value") {
      return {
        ...m,
        label: `Estimated price (${referenceM2} m²)`,
        short: "Price",
        format: locale.moneyCompact,
      };
    }
    if (m.key === "ppsf") {
      return {
        ...m,
        label: "Average price per m²",
        short: "kr/m²",
        property: "price_per_m2",
        format: locale.perArea,
      };
    }
    return m;
  });
}
