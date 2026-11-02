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

// ---- Market (spec 023 R1/R2) ------------------------------------------------

export interface CohortOut {
  cohort_id: string;
  variant_id: string;
  make: string;
  model: string;
  trim_group: string;
  model_year: number;
  energy_type: EnergyType;
  drive: Drive;
  body: string;
  n_listings: number;
  ref_km: number;
  value_ref_ore: number;
  pi_low_ore: number;
  pi_high_ore: number;
  status: Status;
  as_of: string;
  range_km_wltp: number | null;
  efficiency_wh_per_km: number;
  accel_0_100_s: string | null;
  meets_must_haves: boolean;
}

export type ListingsMode = "r2" | "fixture" | "unavailable";

export interface CohortsResponse {
  bundle_as_of: string;
  listings_mode: ListingsMode;
  n_listings_total: number;
  cohorts: CohortOut[];
}

/** One dot on the market map: a listing in its latest `listed` snapshot. */
export interface MarketPoint {
  listing_id: string;
  variant_id: string;
  cohort_id: string;
  model_year: number;
  ask_ore: number;
  km: number;
  seller_type: "dealer" | "private";
  first_reg_month: string | null;
  snapshot_date: string;
}

export interface MarketPointsResponse {
  bundle_as_of: string;
  listings_mode: ListingsMode;
  n_points: number;
  points: MarketPoint[];
}

export interface MarketFilters {
  make?: string;
  year_from?: number;
  year_to?: number;
  max_price_nok?: number;
  energy_type?: EnergyType[];
  must_have?: string[];
}

function filterQuery(f: MarketFilters): string {
  const q = new URLSearchParams();
  if (f.make) q.set("make", f.make);
  if (f.year_from !== undefined) q.set("year_from", String(f.year_from));
  if (f.year_to !== undefined) q.set("year_to", String(f.year_to));
  if (f.max_price_nok !== undefined) q.set("max_price_nok", String(f.max_price_nok));
  for (const e of f.energy_type ?? []) q.append("energy_type", e);
  for (const m of f.must_have ?? []) q.append("must_have", m);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export async function getCohorts(f: MarketFilters = {}, signal?: AbortSignal): Promise<CohortsResponse> {
  if (isMockMode()) {
    const { buildCohorts } = await import("./mock/fixture");
    return buildCohorts(f);
  }
  const res = await fetch(`${CARS_BASE}/market/cohorts${filterQuery(f)}`, { signal });
  return readJson<CohortsResponse>(res, "/cars/market/cohorts");
}

export async function getMarketPoints(
  f: MarketFilters = {},
  signal?: AbortSignal,
): Promise<MarketPointsResponse> {
  if (isMockMode()) {
    const { buildMarketPoints } = await import("./mock/fixture");
    return buildMarketPoints(f);
  }
  const res = await fetch(`${CARS_BASE}/market/points${filterQuery(f)}`, { signal });
  return readJson<MarketPointsResponse>(res, "/cars/market/points");
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

// ---- Recommendations (spec 024 R11/R12) ------------------------------------

export interface RecommendRequest {
  profile: Profile;
  measure: Measure;
  /** Rows wanted (1..10); tag holders outside the top n are appended. */
  n: number;
  seed: number;
  /** 100..1000: the server caps draws so the whole catalogue stays under two seconds. */
  draws: number;
}

export const RECOMMEND_REASONS = [
  "lowest expected cost",
  "narrowest uncertainty band",
  "best fun score",
  "lowest cash up front",
] as const;
export type RecommendReason = (typeof RECOMMEND_REASONS)[number];

export interface RecommendRow {
  /** Position in the full ranking by the requested measure (1 = best). */
  rank: number;
  reasons: string[];
  summary: OptionSummary;
}

export interface RecommendResponse {
  ranking_measure: Measure;
  bundle_as_of: string;
  start_date: string;
  n_considered: number;
  ruled_out: Record<string, number>;
  skipped: number;
  rows: RecommendRow[];
  elapsed_ms: number;
}

export async function postRecommend(
  request: RecommendRequest,
  signal?: AbortSignal,
): Promise<RecommendResponse> {
  if (isMockMode()) {
    const { buildRecommend } = await import("./mock/fixture");
    return buildRecommend(request);
  }
  const res = await fetch(`${CARS_BASE}/recommend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  return readJson<RecommendResponse>(res, "/cars/recommend");
}

// ---- Sources (spec 023 R5: pending tax rules for the checklist) -------------

export interface SourceHealthOut {
  name: string;
  last_fetch: string | null;
  rows: number;
  quarantined: number;
  status: "ok" | "stale" | "failed" | "manual" | "disabled";
  note: string;
}

export interface PendingRuleOut {
  id: string;
  kind?: string;
  effective_from?: string;
  [key: string]: unknown;
}

export interface SourcesResponse {
  bundle_as_of: string;
  listings_mode: ListingsMode;
  sources: SourceHealthOut[];
  pending_rules: PendingRuleOut[];
  unverified_rules: string[];
}

export async function getSources(signal?: AbortSignal): Promise<SourcesResponse> {
  if (isMockMode()) {
    return {
      bundle_as_of: "2026-10-31",
      listings_mode: "fixture",
      sources: [],
      pending_rules: [{ id: "ev_vat_2027_proposed", kind: "ev_vat", effective_from: "2027-01-01" }],
      unverified_rules: [],
    };
  }
  const res = await fetch(`${CARS_BASE}/sources`, { signal });
  return readJson<SourcesResponse>(res, "/cars/sources");
}
