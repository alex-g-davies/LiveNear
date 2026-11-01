// Cars API wrappers and hand-written response types (spec 022 R10). Every
// call goes to the backend under /api/cars. Money fields ending in `_ore` are
// integer øre; Decimal fields arrive as strings. With `?mock=1` in the URL the
// fixture builder answers instead, so the screens render without a backend.

import { API_BASE } from "../config";
import type { CarProfile, Measure, Mode, SelectionItem, WhatIf } from "./lib/profile";

export const CARS_BASE = `${API_BASE}/cars`;

export type EnergyType = "ev" | "phev" | "hybrid" | "ice";
export type Drive = "rwd" | "fwd" | "awd";
export type ExitMonthKey = "12" | "24" | "36" | "48";
export type Status = "live" | "estimate";

export interface VehicleOut {
  variant_id: string;
  make: string;
  model: string;
  trim_group: string;
  segment: string;
  model_years: number[];
  energy_type: EnergyType;
  drive: Drive;
  body: string;
  battery_kwh: string | null;
  power_kw: number | null;
  heat_pump: boolean;
  auto_precondition: boolean;
  range_km_wltp: number | null;
  accel_0_100_s: string | null;
  fun_score: string;
  new_price_ore: number | null;
  has_lease_offer: boolean;
}

/** Wire form of the profile: Decimal-ish fields may be strings. */
export type Profile = Omit<CarProfile, "return_on_cash_pct"> & {
  return_on_cash_pct: string | number;
};

export type WhatIfIn = WhatIf;

export interface ScenarioRequest {
  profile: Profile;
  selection: SelectionItem[];
  what_if?: WhatIfIn | null;
  overrides: Record<string, string | number>;
  measure: Measure;
  seed: number;
  draws: number;
}

export interface Band {
  p10: number[];
  p50: number[];
  p90: number[];
}

export interface PointAt {
  month: number;
  value: number;
}

export interface MeasureResult {
  band: Band;
  deterministic: number[];
  expected: { p10: number; p50: number; p90: number };
  expected_det: number;
  best: PointAt;
  worst: PointAt;
}

export interface LineItemView {
  key: string;
  label: string;
  group: "cash" | "exit";
  estimate: boolean;
  used: string[];
  at_exit: Record<ExitMonthKey, number>;
}

export interface InputView {
  id: string;
  /** Readable name from the API; screens show this, never the id. */
  label: string;
  value: string;
  source: string;
  as_of: string;
  status: Status;
  basis: string | null;
  range: [string, string] | null;
  used_by: string[];
  share_of_tco: number;
  material: boolean;
}

export interface DisplayItem {
  key: string;
  label: string;
  ore: number;
}

export interface OptionResult {
  option_id: string;
  label: string;
  mode: Mode;
  make: string;
  model: string;
  trim_group: string;
  model_year: number;
  fun_score: string;
  status: Status;
  material_estimates: string[];
  /** Readable labels for `material_estimates`, same order. */
  material_estimate_labels: string[];
  cash_up_front: number;
  km_at: number[];
  measures: Record<Measure, MeasureResult>;
  line_items: LineItemView[];
  display: Record<ExitMonthKey, DisplayItem[]>;
  inputs: InputView[];
  resale_p50: number[] | null;
}

export interface OptionSummary {
  result: OptionResult;
  variant_id: string;
  option_kind: Mode;
  seller_type: "dealer" | "private" | null;
  lease_offer_id: string | null;
}

export interface RuledOut {
  option_id: string;
  label: string;
  reasons: string[];
}

export interface SensitivityRow {
  driver: string;
  label: string;
  low: number;
  high: number;
  note: string;
}

export interface ScenarioResponse {
  ranking_measure: Measure;
  exit_odds: Record<ExitMonthKey, number>;
  seed: number;
  draws: number;
  bundle_as_of: string;
  start_date: string;
  options: OptionSummary[];
  ruled_out: RuledOut[];
  skipped: string[];
  sensitivity: SensitivityRow[];
  sensitivity_option_id: string | null;
  elapsed_ms: number;
}

/** `?mock=1` anywhere in the URL switches to the in-browser fixture. */
export function isMockMode(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("mock") === "1";
  } catch {
    return false;
  }
}

async function readJson<T>(res: Response, path: string): Promise<T> {
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = `: ${body.detail}`;
    } catch {
      /* no body */
    }
    throw new Error(`${path} -> ${res.status}${detail}`);
  }
  return (await res.json()) as T;
}

export async function getVehicles(signal?: AbortSignal): Promise<VehicleOut[]> {
  if (isMockMode()) {
    const { buildVehicles } = await import("./mock/fixture");
    return buildVehicles();
  }
  const res = await fetch(`${CARS_BASE}/vehicles`, { signal });
  return readJson<VehicleOut[]>(res, "/cars/vehicles");
}

export async function postScenario(
  request: ScenarioRequest,
  signal?: AbortSignal,
): Promise<ScenarioResponse> {
  if (isMockMode()) {
    const { buildScenario } = await import("./mock/fixture");
    return buildScenario(request);
  }
  const res = await fetch(`${CARS_BASE}/scenarios`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  return readJson<ScenarioResponse>(res, "/cars/scenarios");
}
