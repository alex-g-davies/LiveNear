// Market map helpers (spec 023 R2/R3): the dot model shared by the scatter
// and the screen, axis definitions, and pure selection arithmetic (add or
// remove (variant, year) pairs as merged contiguous year ranges).

import type { CohortOut, Drive, EnergyType, MarketPoint, VehicleOut } from "../api";
import type { SelectionItem } from "./profile";
import { hasKey, t, tDynamic } from "../../i18n/core";

export type XAxis = "year" | "km" | "range";
export type YAxis = "price" | "range" | "efficiency" | "accel";
export type ColorBy = "energy" | "drive" | "body";

// Labels are getters, so every read is in the current language (spec 028).
export const X_AXES: { key: XAxis; readonly label: string }[] = [
  { key: "year", get label() { return t("carsPlan.axis.year"); } },
  { key: "km", get label() { return t("carsPlan.axis.km"); } },
  { key: "range", get label() { return t("carsPlan.axis.range"); } },
];
export const Y_AXES: { key: YAxis; readonly label: string; unit: string }[] = [
  { key: "price", get label() { return t("carsPlan.axis.price"); }, unit: "kr" },
  { key: "range", get label() { return t("carsPlan.axis.range"); }, unit: "km" },
  { key: "efficiency", get label() { return t("carsPlan.axis.efficiency"); }, unit: "Wh/km" },
  { key: "accel", label: "0–100 km/h", unit: "s" },
];
export const COLOR_BYS: { key: ColorBy; readonly label: string }[] = [
  { key: "energy", get label() { return t("carsPlan.colourBy.energy"); } },
  { key: "drive", get label() { return t("carsPlan.colourBy.drive"); } },
  { key: "body", get label() { return t("carsPlan.colourBy.body"); } },
];

export const ENERGY_LABELS: Readonly<Record<EnergyType, string>> = {
  get ev() { return t("carsPlan.energy.ev"); },
  get phev() { return t("carsPlan.energy.phev"); },
  get hybrid() { return t("carsPlan.energy.hybrid"); },
  get ice() { return t("carsPlan.energy.ice"); },
};
// Drive codes are the same in every language.
export const DRIVE_LABELS: Record<Drive, string> = { rwd: "RWD", fwd: "FWD", awd: "AWD" };

/** A body style from the catalogue in the current language; unknown styles
 * keep the catalogue's word, capitalised. */
export function bodyLabel(body: string): string {
  if (!body) return t("carsPlan.body.other");
  const key = `carsPlan.body.${body.toLowerCase()}`;
  if (hasKey(key)) return tDynamic(key);
  return body.charAt(0).toUpperCase() + body.slice(1);
}

/** One dot: a listing, or a cohort median when listings are unavailable. */
export interface Dot {
  key: string;
  variant_id: string;
  model_year: number;
  cohort_id: string;
  label: string; // "Tesla Model 3 Long Range RWD"
  ask_ore: number;
  km: number;
  range_km: number | null;
  efficiency: number | null;
  accel_s: number | null;
  energy: EnergyType;
  drive: Drive;
  body: string;
  seller: "dealer" | "private" | null;
  /** Deterministic jitter in [-0.3, 0.3] model years so stacked dots spread. */
  jitter: number;
  isCohort: boolean;
}

function jitterOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000 - 0.5) * 0.6;
}

export function dotsFromPoints(points: MarketPoint[], cohorts: CohortOut[]): Dot[] {
  const byCohort = new Map(cohorts.map((c) => [c.cohort_id, c]));
  const out: Dot[] = [];
  for (const p of points) {
    const c = byCohort.get(p.cohort_id);
    if (!c) continue;
    out.push({
      key: p.listing_id,
      variant_id: p.variant_id,
      model_year: p.model_year,
      cohort_id: p.cohort_id,
      label: `${c.make} ${c.model} ${c.trim_group}`,
      ask_ore: p.ask_ore,
      km: p.km,
      range_km: c.range_km_wltp,
      efficiency: c.efficiency_wh_per_km,
      accel_s: c.accel_0_100_s === null ? null : Number(c.accel_0_100_s),
      energy: c.energy_type,
      drive: c.drive,
      body: c.body,
      seller: p.seller_type,
      jitter: jitterOf(p.listing_id),
      isCohort: false,
    });
  }
  return out;
}

export function dotsFromCohorts(cohorts: CohortOut[]): Dot[] {
  return cohorts.map((c) => ({
    key: c.cohort_id,
    variant_id: c.variant_id,
    model_year: c.model_year,
    cohort_id: c.cohort_id,
    label: `${c.make} ${c.model} ${c.trim_group}`,
    ask_ore: c.value_ref_ore,
    km: c.ref_km,
    range_km: c.range_km_wltp,
    efficiency: c.efficiency_wh_per_km,
    accel_s: c.accel_0_100_s === null ? null : Number(c.accel_0_100_s),
    energy: c.energy_type,
    drive: c.drive,
    body: c.body,
    seller: null,
    jitter: 0,
    isCohort: true,
  }));
}

export function xValue(d: Dot, axis: XAxis): number | null {
  if (axis === "year") return d.model_year + d.jitter;
  if (axis === "km") return d.km;
  return d.range_km;
}

export function yValue(d: Dot, axis: YAxis): number | null {
  if (axis === "price") return d.ask_ore;
  if (axis === "range") return d.range_km;
  if (axis === "efficiency") return d.efficiency;
  return d.accel_s;
}

export function colorKey(d: Dot, by: ColorBy): string {
  if (by === "energy") return ENERGY_LABELS[d.energy];
  if (by === "drive") return DRIVE_LABELS[d.drive];
  return bodyLabel(d.body);
}

// ---- selection arithmetic ---------------------------------------------------

export function isSelected(selection: SelectionItem[], variantId: string, year: number): boolean {
  return selection.some((s) => s.variant_id === variantId && s.year_from <= year && year <= s.year_to);
}

export function selectedYears(selection: SelectionItem[], variantId: string): Set<number> {
  const out = new Set<number>();
  for (const s of selection) {
    if (s.variant_id !== variantId) continue;
    for (let y = s.year_from; y <= s.year_to; y++) out.add(y);
  }
  return out;
}

/** Rebuild a variant's items from a set of years as contiguous ranges, keeping
 * other variants' items and their order. */
export function withYears(selection: SelectionItem[], variantId: string, years: Set<number>): SelectionItem[] {
  const others = selection.filter((s) => s.variant_id !== variantId);
  const sorted = [...years].sort((a, b) => a - b);
  const ranges: SelectionItem[] = [];
  for (const y of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && last.year_to === y - 1) last.year_to = y;
    else ranges.push({ variant_id: variantId, year_from: y, year_to: y });
  }
  const firstIdx = selection.findIndex((s) => s.variant_id === variantId);
  if (firstIdx < 0) return [...others, ...ranges];
  const before = selection.slice(0, firstIdx).filter((s) => s.variant_id !== variantId);
  const after = selection.slice(firstIdx).filter((s) => s.variant_id !== variantId);
  return [...before, ...ranges, ...after];
}

export function addPairs(selection: SelectionItem[], pairs: Iterable<[string, number]>): SelectionItem[] {
  const byVariant = new Map<string, Set<number>>();
  for (const [vid, year] of pairs) {
    if (!byVariant.has(vid)) byVariant.set(vid, selectedYears(selection, vid));
    byVariant.get(vid)!.add(year);
  }
  let out = selection;
  for (const [vid, years] of byVariant) out = withYears(out, vid, years);
  return out;
}

/** Distinct variants one scenario may compare. Mirrors MAX_COMPARE_VARIANTS
 * in backend/app/cars/schemas.py (spec 024 R18); the server refuses more. */
export const MAX_COMPARE_VARIANTS = 30;
/** The cap message in the current language. */
export function capHint(): string {
  return t("carsPlan.capHint", { max: MAX_COMPARE_VARIANTS });
}
/** English cap message; screens use `capHint()` (spec 028). */
export const CAP_HINT = `You can compare up to ${MAX_COMPARE_VARIANTS} cars at once. Remove one to add another.`;

export function variantCount(selection: SelectionItem[]): number {
  return new Set(selection.map((s) => s.variant_id)).size;
}

/** True when adding these variants would push the selection past the cap. */
export function wouldExceedCap(selection: SelectionItem[], variantIds: Iterable<string>): boolean {
  const ids = new Set(selection.map((s) => s.variant_id));
  for (const id of variantIds) ids.add(id);
  return ids.size > MAX_COMPARE_VARIANTS;
}

/** Keep the first MAX_COMPARE_VARIANTS variants (in first-seen order) and drop
 * the rest, so a box select on the Market map can never produce a request the
 * server would refuse. Every year range of a kept variant stays. */
export function capSelection(selection: SelectionItem[]): SelectionItem[] {
  const kept = new Set<string>();
  for (const s of selection) {
    if (kept.size < MAX_COMPARE_VARIANTS || kept.has(s.variant_id)) kept.add(s.variant_id);
  }
  return kept.size === variantCount(selection) ? selection : selection.filter((s) => kept.has(s.variant_id));
}

export function togglePair(selection: SelectionItem[], variantId: string, year: number): SelectionItem[] {
  const years = selectedYears(selection, variantId);
  if (years.has(year)) years.delete(year);
  else years.add(year);
  return withYears(selection, variantId, years);
}

export function removeVariant(selection: SelectionItem[], variantId: string): SelectionItem[] {
  return selection.filter((s) => s.variant_id !== variantId);
}

export function fullRange(v: VehicleOut): SelectionItem {
  return {
    variant_id: v.variant_id,
    year_from: Math.min(...v.model_years),
    year_to: Math.max(...v.model_years),
  };
}

/** Human year range for a variant's items: "2021–2024" or "2021, 2023–2024". */
export function yearRangeLabel(selection: SelectionItem[], variantId: string): string {
  return selection
    .filter((s) => s.variant_id === variantId)
    .sort((a, b) => a.year_from - b.year_from)
    .map((s) => (s.year_from === s.year_to ? `${s.year_from}` : `${s.year_from}–${s.year_to}`))
    .join(", ");
}

/** Client-side text filter: make + model + trim substring, case-insensitive. */
export function matchesSearch(d: { label: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || d.label.toLowerCase().includes(q);
}
