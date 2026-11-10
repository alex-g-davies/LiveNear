// Thin fetch wrappers. Every call targets the backend (API_BASE) — never
// api.mapbox.com — so the Mapbox token stays server-side (R5).

import { API_BASE } from "../config";
import type { FeatureCollection } from "geojson";

export interface ZipValue {
  zip: string;
  median_value: number;
  // Enriched metrics (spec 002); null when unavailable.
  yoy_pct: number | null;
  cagr5_pct: number | null;
  ppsf: number | null;
  history: [string, number][] | null;
  // Census ACS context (spec 008); null when unavailable.
  population: number | null;
  median_income: number | null;
  price_to_income: number | null;
  // GeoNames primary place name (spec 012); null when unavailable.
  name: string | null;
  // Norway (spec 026): absent on US records.
  price_per_m2?: number | null;
  sales?: number | null;
  area_type?: string | null;
  income_level?: string | null;
}

export interface HousingResponse {
  metro: string;
  currency: string;
  as_of: string;
  zips: ZipValue[];
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return (await res.json()) as T;
}

export const getHousing = (state: string) =>
  getJson<HousingResponse>(`/housing?state=${state}`);

export const getZipsGeojson = (state: string) =>
  getJson<FeatureCollection>(`/zips.geojson?state=${state}`);

export interface RegionInfo {
  code: string;
  name: string;
  bbox: [number, number, number, number] | null;
  center: [number, number] | null;
  zip_count: number;
  // Presentation (spec 026 R7); absent means the US defaults.
  country?: string;
  currency?: string;
  timezone?: string | null;
  units?: string;
  region_label?: string;
  area_label?: string;
  metrics?: string[] | null;
  reference_m2?: number | null;
}

export const getRegions = () => getJson<RegionInfo[]>("/regions");

export const getIsochrone = (lat: number, lon: number, minutes: number, mode = "drive") =>
  getJson<FeatureCollection>(
    `/isochrone?lat=${lat}&lon=${lon}&minutes=${minutes}` +
      (mode === "drive" ? "" : `&mode=${mode}`),
  );

export interface GeocodeResult {
  lat: number;
  lon: number;
  place_name: string;
}

/** Routed commute estimate for a (home, work) pair (spec 013): min–max over
 * rush-window samples for drive; min == max with null windows for walk/cycle. */
export interface CommuteEstimate {
  mode: string;
  am_min_minutes: number;
  am_max_minutes: number;
  am_window_start_local: string | null;
  am_window_end_local: string | null;
  pm_min_minutes: number;
  pm_max_minutes: number;
  pm_window_start_local: string | null;
  pm_window_end_local: string | null;
}

/** Routed times home->work (AM) and work->home (PM). Throws on any non-OK
 * status — callers treat failures as "no estimate" (best-effort). */
export const getCommute = (
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  mode = "drive",
) =>
  getJson<CommuteEstimate>(
    `/commute?from_lat=${from.lat}&from_lon=${from.lon}&to_lat=${to.lat}&to_lon=${to.lon}` +
      (mode === "drive" ? "" : `&mode=${mode}`),
  );

/** Reach-area variation across departure scenarios (spec 003). */
export interface CommuteVariation {
  offpeak_sqmi: number | null;
  typical_sqmi: number | null;
  peak_sqmi: number | null;
  peak_shrink_pct: number | null;
}

/** Reverse-geocode a pin position via the backend (015 R1). Resolves to null
 * on a 404 (no nearby address) — absence is a normal outcome, not an error. */
export async function getReverseGeocode(lat: number, lon: number): Promise<GeocodeResult | null> {
  const res = await fetch(`${API_BASE}/geocode/reverse?lat=${lat}&lon=${lon}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`reverse geocode -> ${res.status}`);
  return (await res.json()) as GeocodeResult;
}

/** Forward-geocode an address via the backend, optionally biased toward a
 * point — the selected region's center (010 R3). Throws Error("not_found") on
 * a 404 (no match) so callers can show a friendly message; never calls Mapbox. */
export async function getGeocode(
  q: string,
  proximity?: { lat: number; lon: number },
): Promise<GeocodeResult> {
  let url = `${API_BASE}/geocode?q=${encodeURIComponent(q)}`;
  if (proximity) url += `&proximity_lat=${proximity.lat}&proximity_lon=${proximity.lon}`;
  const res = await fetch(url);
  if (res.status === 404) throw new Error("not_found");
  if (!res.ok) throw new Error(`geocode -> ${res.status}`);
  return (await res.json()) as GeocodeResult;
}
