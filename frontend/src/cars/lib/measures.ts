// Measure metadata shared by the Compare views and Detail (spec 022 R11):
// labels, units, and how to format a value of each measure. Words are read
// from the catalogue at call time (spec 028), so the getters below always
// answer in the site language.

import { LANG_TAGS, getLang, t, type TKey } from "../../i18n/core";
import { materialLabel } from "../../i18n/backendLabels";
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

function def(key: Measure, format: (value: number) => string): MeasureDef {
  return {
    key,
    get label() {
      return t(`carsCompare.measure.${key}.label` as TKey);
    },
    get unit() {
      return t(`carsCompare.measure.${key}.unit` as TKey);
    },
    get blurb() {
      return t(`carsCompare.measure.${key}.blurb` as TKey);
    },
    format,
  };
}

export const MEASURE_DEFS: MeasureDef[] = [
  def("per_month", formatNok),
  def("tco", formatNok),
  def("npc", formatNok),
  def("cash_up_front", formatNok),
  def("per_km", formatPerKm),
];

export const measureDef = (key: Measure): MeasureDef =>
  MEASURE_DEFS.find((m) => m.key === key) ?? MEASURE_DEFS[0];

/** A measure label inside a sentence ("expected net cost per month"),
 *  lower-cased by the rules of the site language (Turkish I/ı). */
export function measureInSentence(m: MeasureDef): string {
  return m.label.toLocaleLowerCase(LANG_TAGS[getLang()]);
}

function modeText(prefix: "mode" | "modeFilter", mode: Mode): string {
  if (mode === "used_1_3") return t(`carsCompare.${prefix}.used_1_3`, { from: 1, to: 3 });
  if (mode === "used_5_plus") return t(`carsCompare.${prefix}.used_5_plus`, { from: 5 });
  return t(`carsCompare.${prefix}.${mode}`);
}

function modeRecord(prefix: "mode" | "modeFilter"): Record<Mode, string> {
  const modes: Mode[] = ["new", "lease", "used_1_3", "used_5_plus"];
  const out = {} as Record<Mode, string>;
  for (const m of modes) Object.defineProperty(out, m, { enumerable: true, get: () => modeText(prefix, m) });
  return out;
}

/** "Buy new", "Lease", "Used, 1–3 years", "Used, 5+ years" (site language). */
export const MODE_LABELS: Record<Mode, string> = modeRecord("mode");

/** Short forms for the filter pills. */
export const MODE_FILTER_LABELS: Record<Mode, string> = modeRecord("modeFilter");

/** Readable labels for an option's material estimates, by key where the
 *  catalogue has one (028 R6), else the backend's English label. */
export function estimateLabels(r: { material_estimates?: string[]; material_estimate_labels: string[] }): string[] {
  return r.material_estimate_labels.map((label, i) => {
    const id = r.material_estimates?.[i];
    return id ? materialLabel(id, label) : label;
  });
}

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
export const CAR_COLORS = Array.from({ length: 8 }, (_, i) => `var(--c-series-${i + 1})`);

export function colorForIndex(i: number): string {
  return CAR_COLORS[i % CAR_COLORS.length];
}
