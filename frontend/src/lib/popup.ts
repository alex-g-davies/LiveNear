// Build the hover/tap popup HTML for a ZIP. Pure (returns a string) so it can be
// fed to MapLibre's setHTML and unit-tested without a map.

import type { ZipValue } from "../api/client";
import { t } from "../i18n/core";
import { formatPct, formatPpsf, formatUsd, placeLabel } from "./format";
import { type Locale, US_LOCALE } from "./locale";
import { buildSparklineSvg } from "./sparkline";

function norwayPopup(
  id: string,
  rec: ZipValue | undefined,
  locale: Locale,
  fallbackName: string | null,
): string {
  const rows = [`<div class="tip__zip">${locale.place(id, rec?.name ?? fallbackName)}</div>`];
  if (!rec) {
    rows.push(`<div class="tip__val">${t("map.noPriceData")}</div>`);
    rows.push(`<div class="tip__ppsf">${t("map.popup.fewSales", { min: 10 })}</div>`);
    return `<div class="tip">${rows.join("")}</div>`;
  }
  rows.push(`<div class="tip__val">≈ ${locale.money(rec.median_value)}</div>`);
  if (rec.price_per_m2 != null) {
    rows.push(`<div class="tip__ppsf">${t("map.popup.average", { value: locale.perArea(rec.price_per_m2) })}</div>`);
  }
  return `<div class="tip">${rows.join("")}</div>`;
}

export function buildZipPopupHtml(
  zip: string,
  rec: ZipValue | undefined,
  stateCode?: string,
  locale: Locale = US_LOCALE,
  fallbackName?: string | null,
): string {
  if (locale.country !== "US") return norwayPopup(zip, rec, locale, fallbackName ?? null);
  const header = zip ? placeLabel(zip, rec?.name ?? null, stateCode) : t("map.place.zip", { zip: "—" });
  const rows: string[] = [`<div class="tip__zip">${header}</div>`];

  if (!rec) {
    rows.push(`<div class="tip__val">${t("map.noPriceData")}</div>`);
    return `<div class="tip">${rows.join("")}</div>`;
  }

  rows.push(`<div class="tip__val">${formatUsd(rec.median_value)}</div>`);

  const metrics: string[] = [];
  if (rec.yoy_pct != null) {
    const dir = rec.yoy_pct >= 0 ? "up" : "down";
    const arrow = rec.yoy_pct >= 0 ? "▲" : "▼";
    metrics.push(
      `<span class="tip__metric tip__metric--${dir}">${arrow} ${t("map.popup.yoy", { pct: formatPct(rec.yoy_pct) })}</span>`,
    );
  }
  if (rec.cagr5_pct != null) {
    metrics.push(`<span class="tip__metric">${t("map.popup.cagr", { pct: formatPct(rec.cagr5_pct), years: 5 })}</span>`);
  }
  if (metrics.length) rows.push(`<div class="tip__row">${metrics.join("")}</div>`);

  rows.push(
    `<div class="tip__ppsf">${
      rec.ppsf != null ? t("map.popup.ppsfSold", { value: formatPpsf(rec.ppsf) }) : t("map.popup.ppsfNone")
    }</div>`,
  );

  const spark = buildSparklineSvg(rec.history);
  if (spark) rows.push(spark);

  return `<div class="tip">${rows.join("")}</div>`;
}
