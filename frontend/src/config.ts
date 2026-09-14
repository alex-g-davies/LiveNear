// Single source of truth for shared map/legend constants. The color ramps live
// here so the choropleth and the legend can never drift apart (R2).

import { formatPct, formatPpsf, formatUsdCompact } from "./lib/format";

// Product name, referenced by components instead of hardcoding it so a
// rename is a one-line change (018).
export const BRAND_NAME = "LiveNear";

// Backend API base. In dev, Vite proxies /api -> http://localhost:8000, so the
// frontend only ever calls its own origin — no Mapbox token reaches the client (R5).
export const API_BASE = "/api";

// Keyless MapLibre basemap. Using Mapbox tiles would require a token in the
// client, which would violate R5 — CARTO Positron needs no token and its light
// ground maximizes choropleth legibility.
export const BASEMAP_STYLE_URL =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

// Opening view before any region/geolocation resolves (the default region's
// largest metro keeps the first paint data-dense).
export const MAP_CENTER: [number, number] = [-122.33, 47.64];
export const MAP_ZOOM = 10.2;

// Default region when none is chosen (also the URL-serialization default).
export const DEFAULT_STATE = "WA";

// Fallback work location (inside the default region's main job center) used
// until the user drags the pin, searches an address, or geolocation resolves.
export interface WorkLocation {
  lat: number;
  lon: number;
}
export const DEFAULT_WORK: WorkLocation = { lat: 47.518, lon: -122.2966 };

// Sequential ramp keyed on median home value (USD). Ascending stops; cool->deep
// reads as "more expensive". Shared by the map fill and the legend swatches.
export interface ColorStop {
  value: number;
  color: string;
}

// Breaks chosen to spread the bulk of the metro (most ZIPs fall 450k–1.8M);
// values above the top stop clamp to the darkest color.
export const COLOR_STOPS: ColorStop[] = [
  { value: 450_000, color: "#c6dbef" },
  { value: 700_000, color: "#9ecae1" },
  { value: 950_000, color: "#6baed6" },
  { value: 1_300_000, color: "#3182bd" },
  { value: 1_800_000, color: "#08519c" },
];

// Diverging ramp for year-over-year % change, centered on 0 (red = falling,
// green = rising), clamped to ±6% so the metro's mid-range stays legible.
export const YOY_STOPS: ColorStop[] = [
  { value: -6, color: "#d73027" },
  { value: -3, color: "#fc8d59" },
  { value: 0, color: "#ffffbf" },
  { value: 3, color: "#91cf60" },
  { value: 6, color: "#1a9850" },
];

// Sequential ramp for sold price per square foot ($). Breaks spread the metro
// (most ZIPs ~$200–$700/sqft; a few enclaves clamp to the top).
export const PPSF_STOPS: ColorStop[] = [
  { value: 200, color: "#f2f0f7" },
  { value: 350, color: "#cbc9e2" },
  { value: 500, color: "#9e9ac8" },
  { value: 700, color: "#756bb1" },
  { value: 1000, color: "#54278f" },
];

// ZIPs with no value in the dataset.
export const NO_DATA_COLOR = "#d9d9d9";

// Ramp colors (sequential). Break VALUES are computed at runtime as
// equal-count buckets over each state's distribution, so a cheap state and a
// pricey state both spread across the full ramp; each 8-tier bucket holds the
// state's ~12.5% of ZIPs. Multi-hue ramps (ColorBrewer) are deliberate: the
// light ends are hue-separated from both the gray basemap and the gray
// no-data fill, which single-hue light blues/purples were not (012-sprint
// contrast fix).
export const VALUE_COLORS = [
  "#ffffd9",
  "#edf8b1",
  "#c7e9b4",
  "#7fcdbb",
  "#41b6c4",
  "#1d91c0",
  "#225ea8",
  "#0c2c84",
]; // YlGnBu
export const PPSF_COLORS = [
  "#fff7fb",
  "#ece2f0",
  "#d0d1e6",
  "#a6bddb",
  "#67a9cf",
  "#3690c0",
  "#02818a",
  "#016450",
]; // PuBuGn — distinct teal-green dark end vs the value ramp
export const AFFORD_COLORS = [
  "#ffffcc",
  "#ffeda0",
  "#fed976",
  "#feb24c",
  "#fd8d3c",
  "#fc4e2a",
  "#e31a1c",
  "#b10026",
]; // YlOrRd — darker = higher price-to-income = less affordable

// The metrics the choropleth can shade by. `property` is the GeoJSON feature
// property; `fixedStops` (YoY only — a comparable % scale) overrides the
// per-region quantile breaks. `format` labels legend boundaries.
export type MetricKey = "value" | "yoy" | "ppsf" | "afford";

export interface MetricDef {
  key: MetricKey;
  label: string; // full label (legend title, a11y)
  short: string; // compact label for the switcher button
  property: string;
  colors: string[];
  diverging: boolean;
  format: (value: number) => string;
  fixedStops?: ColorStop[]; // when set, skip per-region quantile breaks
}

export const METRICS: MetricDef[] = [
  {
    key: "value",
    label: "Median value",
    short: "Value",
    property: "median_value",
    colors: VALUE_COLORS,
    diverging: false,
    format: formatUsdCompact,
  },
  {
    key: "yoy",
    label: "YoY change",
    short: "YoY",
    property: "yoy_pct",
    colors: YOY_STOPS.map((s) => s.color),
    diverging: true,
    format: formatPct,
    fixedStops: YOY_STOPS,
  },
  {
    key: "ppsf",
    label: "$/sqft",
    short: "$/sqft",
    property: "ppsf",
    colors: PPSF_COLORS,
    diverging: false,
    format: formatPpsf,
  },
  {
    key: "afford",
    label: "Affordability (price ÷ income)",
    short: "Afford.",
    property: "price_to_income",
    colors: AFFORD_COLORS,
    diverging: false,
    format: (v: number) => `${v.toFixed(1)}×`,
  },
];

// Opacity applied to over-budget ZIPs vs. in-budget ZIPs (R4 de-emphasis).
export const OVER_BUDGET_OPACITY = 0.15;
export const IN_BUDGET_OPACITY = 0.9;

// Monthly-payment budget assumptions (020 R1). Term and the tax + insurance
// allowance are fixed national constants for the MVP; down payment and rate
// are user-overridable defaults. 1.5 %/yr ≈ the U.S. median property-tax
// rate plus typical homeowners insurance.
export const MORTGAGE_TERM_YEARS = 30;
export const TAX_INSURANCE_PCT = 1.5;
export const DEFAULT_DOWN_PCT = 20;
export const DEFAULT_RATE_PCT = 6.5;

// Selectable commute times (min). Mapbox isochrones cap at 60.
export const COMMUTE_STEPS = [15, 30, 45, 60] as const;
export const DEFAULT_MINUTES = 30;

// Travel modes (013 R2). Public transit deferred: Mapbox has no transit API.
export type TravelMode = "drive" | "walk" | "cycle";
export const TRAVEL_MODES: { key: TravelMode; icon: string; label: string }[] = [
  { key: "drive", icon: "🚗", label: "Driving" },
  { key: "cycle", icon: "🚲", label: "Cycling" },
  { key: "walk", icon: "🚶", label: "Walking" },
];
export const DEFAULT_MODE: TravelMode = "drive";

// Departure scenarios, outer (widest reach) -> inner. Keys match the backend
// `scenario` property; order drives the legend.
export interface ScenarioStyle {
  key: "offpeak" | "typical" | "peak";
  label: string;
  line: string;
}
export const SCENARIO_STYLES: ScenarioStyle[] = [
  { key: "offpeak", label: "Light traffic", line: "#2e7d32" },
  { key: "typical", label: "Midday", line: "#f9a825" },
  { key: "peak", label: "Evening rush", line: "#c62828" },
];
