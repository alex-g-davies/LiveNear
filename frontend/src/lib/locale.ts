// How a region presents numbers and places (spec 026 R7, R10, R15). A region
// without a descriptor is treated as US, so existing data needs no changes.
//
// Country and language are separate (spec 028 R9, R10): the region's country
// decides currency, units and number style, in every language; the site
// language decides the words. Word fields are getters, so they read the
// current language each time.

import type { RegionInfo } from "../api/client";
import { METRICS, type MetricDef } from "../config";
import { t } from "../i18n/core";
import {
  departLabel,
  formatCount,
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
  readonly currencyName: string;
  readonly budgetExample: string;
  readonly paymentExample: string;
  money: (value: number) => string;
  moneyCompact: (value: number) => string;
  monthly: (value: number) => string;
  /** Price per unit of floor area. */
  perArea: (value: number) => string;
  /** Reach area, given in square miles as the backend reports it. */
  reachArea: (sqmi: number | null | undefined) => string;
  departure: (iso: string) => string;
  place: (id: string, name: string | null | undefined, regionCode?: string | null) => string;
  /** Whole number in the country's style: "45,000" / "45 000". */
  count: (value: number | null | undefined) => string;
  /** A decimal already written with a point ("6.5×"), in the country's style. */
  decimal: (text: string) => string;
  /** "State" / "Fylke". */
  readonly regionLabel: string;
  /** Singular noun for a map area in running text. */
  readonly areaNoun: string;
  readonly areaPlural: string;
}

export const US_LOCALE: Locale = {
  country: "US",
  currencySymbol: "$",
  get currencyName() {
    return t("map.locale.us.currency");
  },
  get budgetExample() {
    return t("map.locale.example", { value: formatCount(800_000) });
  },
  get paymentExample() {
    return t("map.locale.example", { value: formatCount(3_000) });
  },
  money: formatUsd,
  moneyCompact: formatUsdCompact,
  monthly: formatMonthly,
  perArea: formatPpsf,
  reachArea: formatSqMi,
  departure: (iso) => departLabel(iso),
  place: placeLabel,
  count: formatCount,
  decimal: (text) => text,
  get regionLabel() {
    return t("map.locale.us.region");
  },
  get areaNoun() {
    return t("map.locale.us.area");
  },
  get areaPlural() {
    return t("map.locale.us.areas");
  },
};

const SQ_KM_PER_SQ_MI = 2.589988;
const NBSP = " ";

/** "5000000" -> "5 000 000" with no-break spaces, by hand so every ICU build
 * prints the same (as `cars/lib/format.ts` does). */
function groupDigits(value: number): string {
  const n = Math.round(value);
  const digits = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return n < 0 ? `-${digits}` : digits;
}

function kroner(value: number): string {
  return `${groupDigits(value)} kr`;
}

function kronerCompact(value: number): string {
  return value >= 1_000_000
    ? t("map.unit.millionKr", { value: (value / 1_000_000).toFixed(1).replace(".", ",") })
    : t("map.unit.thousandKr", { value: Math.round(value / 1000) });
}

export const NO_LOCALE: Locale = {
  country: "NO",
  currencySymbol: "kr",
  get currencyName() {
    return t("map.locale.no.currency");
  },
  get budgetExample() {
    return t("map.locale.example", { value: groupDigits(5_000_000) });
  },
  get paymentExample() {
    return t("map.locale.example", { value: groupDigits(30_000) });
  },
  money: kroner,
  moneyCompact: kronerCompact,
  monthly: (value) => t("map.unit.perMonth", { value: kroner(value) }),
  perArea: (value) => `${kroner(value)}/m²`,
  reachArea: (sqmi) => (sqmi == null ? "—" : `${groupDigits(sqmi * SQ_KM_PER_SQ_MI)} km²`),
  departure: (iso) => departLabel(iso, true),
  place: (id, name) => name ?? t("map.place.area", { id }),
  count: (value) => (value == null ? "—" : groupDigits(value)),
  decimal: (text) => text.replace(".", ","),
  get regionLabel() {
    return t("map.locale.no.region");
  },
  get areaNoun() {
    return t("map.locale.no.area");
  },
  get areaPlural() {
    return t("map.locale.no.areas");
  },
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

/** The metrics a region can show, labelled for its units (026 R9, R10).
 * Labels are read in the current language; recompute when it changes. */
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
        label: t("map.metric.noValue.label", { m2: referenceM2 }),
        short: t("map.metric.noValue.short"),
        format: locale.moneyCompact,
      };
    }
    if (m.key === "ppsf") {
      return {
        ...m,
        label: t("map.metric.noPpsf.label"),
        short: "kr/m²",
        property: "price_per_m2",
        format: locale.perArea,
      };
    }
    if (m.key === "afford") {
      return { ...m, label: m.label, short: m.short, format: (v: number) => `${v.toFixed(1).replace(".", ",")}×` };
    }
    return m;
  });
}
