// Measure metadata shared by the Compare views and Detail (spec 022 R11):
// labels, units, and how to format a value of each measure.

import { formatNok, formatPerKm } from "./format";
import type { Measure, Mode } from "./profile";

export interface MeasureDef {
  key: Measure;
  label: string;
  /** Short unit for axis labels and column headers. */
  unit: string;
  /** Sentence used in the Compare header. */
  blurb: string;
  format: (value: number) => string;
}

export const MEASURE_DEFS: MeasureDef[] = [
  {
    key: "per_month",
    label: "Net cost per month",
    unit: "kr per month",
    blurb: "Net cost per month you have the car, weighted by your odds of leaving at each year.",
    format: formatNok,
  },
  {
    key: "tco",
    label: "Total cost of ownership",
    unit: "kr",
    blurb: "Everything you pay minus what you get back when you sell, weighted by your exit odds.",
    format: formatNok,
  },
  {
    key: "npc",
    label: "Net present cost",
    unit: "kr (today's money)",
    blurb: "Total cost discounted to today, weighted by your exit odds.",
    format: formatNok,
  },
  {
    key: "cash_up_front",
    label: "Cash up front",
    unit: "kr",
    blurb: "What you need in the bank on day one: down payment, fees and first rent.",
    format: formatNok,
  },
  {
    key: "per_km",
    label: "Cost per km",
    unit: "kr per km",
    blurb: "Total cost divided by the kilometres you will drive, weighted by your exit odds.",
    format: formatPerKm,
  },
];

export const measureDef = (key: Measure): MeasureDef =>
  MEASURE_DEFS.find((m) => m.key === key) ?? MEASURE_DEFS[0];

export const MODE_LABELS: Record<Mode, string> = {
  new: "Buy new",
  lease: "Lease",
  used_1_3: "Used, 1–3 years",
  used_5_plus: "Used, 5+ years",
};

export const MODE_FILTER_LABELS: Record<Mode, string> = {
  new: "Buy new",
  lease: "Lease",
  used_1_3: "Used 1–3 yr",
  used_5_plus: "Used 5+ yr",
};

/** SVG dash pattern per way to get the car: solid used, dashed lease, dotted new. */
export function modeDash(mode: Mode): string | undefined {
  if (mode === "lease") return "8 6";
  if (mode === "new") return "2 5";
  return undefined;
}

/** CSS border style equivalent for legends and swatches. */
export function modeBorderStyle(mode: Mode): "solid" | "dashed" | "dotted" {
  if (mode === "lease") return "dashed";
  if (mode === "new") return "dotted";
  return "solid";
}

/** Colour-blind-safer categorical palette, one colour per car (variant). */
export const CAR_COLORS = ["#0B5CD5", "#C2410C", "#0F766E", "#7C3AED", "#B45309", "#BE185D", "#1D4ED8", "#4D7C0F"];

export function colorForIndex(i: number): string {
  return CAR_COLORS[i % CAR_COLORS.length];
}
