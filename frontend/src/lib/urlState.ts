// Shareable-URL codec (spec 009 R5). Pure: parse a query string into validated
// app state, serialize app state back. Invalid params are dropped silently;
// values equal to the app defaults are omitted so shared URLs stay short.

import {
  COMMUTE_STEPS,
  DEFAULT_DOWN_PCT,
  DEFAULT_MINUTES,
  DEFAULT_MODE,
  DEFAULT_RATE_PCT,
  DEFAULT_STATE,
  DEFAULT_WORK,
  METRICS,
  TRAVEL_MODES,
  type MetricKey,
  type TravelMode,
  type WorkLocation,
} from "../config";
import { type BudgetSpec, DEFAULT_BUDGET_SPEC } from "./affordability";

export interface UrlState {
  state?: string;
  zip?: string;
  /** Price-mode budget in dollars. */
  budget?: number;
  /** Payment-mode budget (020 R3): monthly payment + optional assumptions. */
  pay?: number;
  down?: number;
  rate?: number;
  work?: WorkLocation;
  /** Second workplace (016 R6). */
  work2?: WorkLocation;
  minutes?: number;
  metric?: MetricKey;
  tmode?: TravelMode;
}

const METRIC_KEYS = new Set(METRICS.map((m) => m.key));

export function parseAppUrl(search: string): UrlState {
  const params = new URLSearchParams(search);
  const out: UrlState = {};

  const state = params.get("state")?.trim().toUpperCase();
  if (state && /^[A-Z]{2}$/.test(state)) out.state = state;

  const zip = params.get("zip")?.trim();
  if (zip && /^\d{5}$/.test(zip)) out.zip = zip;

  const budget = Number(params.get("budget"));
  if (Number.isFinite(budget) && budget > 0) out.budget = Math.round(budget);

  const pay = Number(params.get("pay"));
  if (params.has("pay") && Number.isFinite(pay) && pay > 0) out.pay = Math.round(pay);
  const down = Number(params.get("down"));
  if (params.has("down") && Number.isFinite(down) && down >= 0 && down <= 99) out.down = down;
  const rate = Number(params.get("rate"));
  if (params.has("rate") && Number.isFinite(rate) && rate >= 0 && rate <= 30) out.rate = rate;

  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  if (
    params.has("lat") &&
    params.has("lon") &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  ) {
    out.work = { lat, lon };
  }

  const lat2 = Number(params.get("lat2"));
  const lon2 = Number(params.get("lon2"));
  if (
    params.has("lat2") &&
    params.has("lon2") &&
    Number.isFinite(lat2) &&
    Number.isFinite(lon2) &&
    Math.abs(lat2) <= 90 &&
    Math.abs(lon2) <= 180
  ) {
    out.work2 = { lat: lat2, lon: lon2 };
  }

  const minutes = Number(params.get("min"));
  if ((COMMUTE_STEPS as readonly number[]).includes(minutes)) out.minutes = minutes;

  const metric = params.get("metric");
  if (metric && METRIC_KEYS.has(metric as MetricKey)) out.metric = metric as MetricKey;

  const tmode = params.get("tmode");
  if (tmode && TRAVEL_MODES.some((m) => m.key === tmode)) out.tmode = tmode as TravelMode;

  return out;
}

/** The budget control's initial state from a parsed URL (020 R3): a `pay`
 * param opens payment mode; otherwise price mode with any `budget`. Both
 * typed values are kept so toggling modes never loses either. */
export function budgetSpecFromUrl(url: UrlState): BudgetSpec {
  return {
    mode: url.pay ? "payment" : "price",
    price: url.budget ?? DEFAULT_BUDGET_SPEC.price,
    payment: url.pay ?? DEFAULT_BUDGET_SPEC.payment,
    downPct: url.down ?? DEFAULT_BUDGET_SPEC.downPct,
    ratePct: url.rate ?? DEFAULT_BUDGET_SPEC.ratePct,
  };
}

export interface AppUrlInput {
  state: string;
  zip: string | null;
  budget: BudgetSpec;
  work: WorkLocation;
  work2: WorkLocation | null;
  minutes: number;
  metric: MetricKey;
  tmode: TravelMode;
}

/** Serialize to a query string ("?…" or "" when everything is default). */
export function serializeAppUrl(s: AppUrlInput): string {
  const params = new URLSearchParams();
  if (s.state !== DEFAULT_STATE) params.set("state", s.state);
  if (s.zip) params.set("zip", s.zip);
  if (s.budget.mode === "payment" && s.budget.payment > 0) {
    params.set("pay", String(s.budget.payment));
    if (s.budget.downPct !== DEFAULT_DOWN_PCT) params.set("down", String(s.budget.downPct));
    if (s.budget.ratePct !== DEFAULT_RATE_PCT) params.set("rate", String(s.budget.ratePct));
  } else if (s.budget.mode === "price" && s.budget.price > 0) {
    params.set("budget", String(s.budget.price));
  }
  if (s.work.lat !== DEFAULT_WORK.lat || s.work.lon !== DEFAULT_WORK.lon) {
    params.set("lat", s.work.lat.toFixed(4));
    params.set("lon", s.work.lon.toFixed(4));
  }
  if (s.work2) {
    params.set("lat2", s.work2.lat.toFixed(4));
    params.set("lon2", s.work2.lon.toFixed(4));
  }
  if (s.minutes !== DEFAULT_MINUTES) params.set("min", String(s.minutes));
  if (s.metric !== METRICS[0].key) params.set("metric", s.metric);
  if (s.tmode !== DEFAULT_MODE) params.set("tmode", s.tmode);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
