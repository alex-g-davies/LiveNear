// Browser-held car profile (spec 022 R2). Types mirror the API's Profile /
// SelectionItem / WhatIfIn. The whole state round-trips through one URL
// parameter `c` (base64url JSON, defaults omitted) and localStorage under
// `livenear.cars.state`. Nothing here ever leaves the browser except as the
// body of a stateless scenario request.

export type Mode = "new" | "lease" | "used_1_3" | "used_5_plus";
export type Measure = "per_month" | "tco" | "npc" | "cash_up_front" | "per_km";
export type PayMode = "cash" | "loan" | "both";
export type AgeBand = "18-24" | "25-29" | "30-39" | "40-49" | "50-64" | "65+";
export type MustHave = "heat_pump" | "auto_precondition" | "awd";
export type ExitKey = "p12" | "p24" | "p36" | "p48";

export const MODES: Mode[] = ["new", "lease", "used_1_3", "used_5_plus"];
export const MEASURES: Measure[] = ["per_month", "tco", "npc", "cash_up_front", "per_km"];
export const AGE_BANDS: AgeBand[] = ["18-24", "25-29", "30-39", "40-49", "50-64", "65+"];
export const MUST_HAVES: MustHave[] = ["heat_pump", "auto_precondition", "awd"];
export const EXIT_KEYS: ExitKey[] = ["p12", "p24", "p36", "p48"];

export interface ExitOdds {
  p12: number;
  p24: number;
  p36: number;
  p48: number;
}

export interface ChargingMix {
  home_pct: number;
  work_free_pct: number;
  public_pct: number;
}

export interface InsuranceProfile {
  age_band: AgeBand;
  claims_free_years: number;
  has_claims_free_letter: boolean;
}

export interface Limits {
  max_price_nok: number | null;
  need_by: string | null;
  must_haves: MustHave[];
  modes: Mode[];
}

export interface CarProfile {
  exit_odds: ExitOdds;
  km_per_year: number;
  charging_mix: ChargingMix;
  municipality: string;
  export_on_exit: boolean;
  pay_mode: PayMode;
  return_on_cash_pct: number;
  down_payment_nok: number;
  has_id_and_bankid: boolean;
  insurance: InsuranceProfile;
  insurance_quotes_nok: Record<string, number>;
  limits: Limits;
  fun_weight: number;
  preferred_measure: Measure;
  start_date: string | null;
}

export interface SelectionItem {
  variant_id: string;
  year_from: number;
  year_to: number;
}

/** What-if overrides for the curves view: request data only until saved. */
export interface WhatIf {
  return_on_cash_pct?: number;
  loan_rate_pct?: number;
  km_per_year?: number;
  used_price_drift_pct?: number;
  pay_mode?: "cash" | "loan";
}

export interface CarState {
  profile: CarProfile;
  selection: SelectionItem[];
  whatIf: WhatIf | null;
  overrides: Record<string, string | number>;
  measure: Measure;
}

export const DEFAULT_PROFILE: CarProfile = {
  exit_odds: { p12: 15, p24: 35, p36: 35, p48: 15 },
  km_per_year: 12_000,
  charging_mix: { home_pct: 70, work_free_pct: 20, public_pct: 10 },
  municipality: "",
  export_on_exit: false,
  pay_mode: "loan",
  return_on_cash_pct: 4,
  down_payment_nok: 0,
  has_id_and_bankid: false,
  insurance: { age_band: "30-39", claims_free_years: 0, has_claims_free_letter: false },
  insurance_quotes_nok: {},
  limits: { max_price_nok: null, need_by: null, must_haves: [], modes: [...MODES] },
  fun_weight: 50,
  preferred_measure: "per_month",
  start_date: null,
};

export const DEFAULT_STATE: CarState = {
  profile: DEFAULT_PROFILE,
  selection: [],
  whatIf: null,
  overrides: {},
  measure: "per_month",
};

export const STORAGE_KEY = "livenear.cars.state";
export const URL_PARAM = "c";

// ---------------------------------------------------------------------------
// Validation helpers — every field is checked so a garbage URL degrades to
// defaults field by field instead of blowing up the screen.

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity): number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
const listOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T[]): T[] =>
  Array.isArray(v)
    ? (v.filter((x) => typeof x === "string" && (allowed as readonly string[]).includes(x)) as T[])
    : fallback;
const isoDate = (v: unknown): string | null =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;

export function sanitizeProfile(raw: unknown): CarProfile {
  const d = DEFAULT_PROFILE;
  if (!isObj(raw)) return { ...d };
  const eo = isObj(raw.exit_odds) ? raw.exit_odds : {};
  const cm = isObj(raw.charging_mix) ? raw.charging_mix : {};
  const ins = isObj(raw.insurance) ? raw.insurance : {};
  const lim = isObj(raw.limits) ? raw.limits : {};
  const quotes: Record<string, number> = {};
  if (isObj(raw.insurance_quotes_nok)) {
    for (const [k, v] of Object.entries(raw.insurance_quotes_nok)) {
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) quotes[k] = v;
    }
  }
  const modes = listOf(lim.modes, MODES, d.limits.modes);
  return {
    exit_odds: {
      p12: num(eo.p12, d.exit_odds.p12, 0, 100),
      p24: num(eo.p24, d.exit_odds.p24, 0, 100),
      p36: num(eo.p36, d.exit_odds.p36, 0, 100),
      p48: num(eo.p48, d.exit_odds.p48, 0, 100),
    },
    km_per_year: num(raw.km_per_year, d.km_per_year, 0, 200_000),
    charging_mix: {
      home_pct: num(cm.home_pct, d.charging_mix.home_pct, 0, 100),
      work_free_pct: num(cm.work_free_pct, d.charging_mix.work_free_pct, 0, 100),
      public_pct: num(cm.public_pct, d.charging_mix.public_pct, 0, 100),
    },
    municipality: str(raw.municipality, d.municipality).slice(0, 80),
    export_on_exit: bool(raw.export_on_exit, d.export_on_exit),
    pay_mode: oneOf(raw.pay_mode, ["cash", "loan", "both"] as const, d.pay_mode),
    return_on_cash_pct: num(
      typeof raw.return_on_cash_pct === "string" ? Number(raw.return_on_cash_pct) : raw.return_on_cash_pct,
      d.return_on_cash_pct,
      0,
      50,
    ),
    down_payment_nok: num(raw.down_payment_nok, d.down_payment_nok, 0, 100_000_000),
    has_id_and_bankid: bool(raw.has_id_and_bankid, d.has_id_and_bankid),
    insurance: {
      age_band: oneOf(ins.age_band, AGE_BANDS, d.insurance.age_band),
      claims_free_years: num(ins.claims_free_years, d.insurance.claims_free_years, 0, 60),
      has_claims_free_letter: bool(ins.has_claims_free_letter, d.insurance.has_claims_free_letter),
    },
    insurance_quotes_nok: quotes,
    limits: {
      max_price_nok:
        lim.max_price_nok === null ? null : num(lim.max_price_nok, NaN, 0, 100_000_000) || null,
      need_by: isoDate(lim.need_by),
      must_haves: listOf(lim.must_haves, MUST_HAVES, d.limits.must_haves),
      modes: modes.length ? modes : d.limits.modes,
    },
    fun_weight: num(raw.fun_weight, d.fun_weight, 0, 100),
    preferred_measure: oneOf(raw.preferred_measure, MEASURES, d.preferred_measure),
    start_date: isoDate(raw.start_date),
  };
}

export function sanitizeSelection(raw: unknown): SelectionItem[] {
  if (!Array.isArray(raw)) return [];
  const out: SelectionItem[] = [];
  for (const item of raw) {
    if (!isObj(item) || typeof item.variant_id !== "string") continue;
    const from = num(item.year_from, NaN, 1990, 2100);
    const to = num(item.year_to, NaN, 1990, 2100);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) continue;
    out.push({ variant_id: item.variant_id, year_from: from, year_to: to });
  }
  return out;
}

export function sanitizeWhatIf(raw: unknown): WhatIf | null {
  if (!isObj(raw)) return null;
  const w: WhatIf = {};
  if (typeof raw.return_on_cash_pct === "number") w.return_on_cash_pct = num(raw.return_on_cash_pct, 0, 0, 50);
  if (typeof raw.loan_rate_pct === "number") w.loan_rate_pct = num(raw.loan_rate_pct, 0, 0, 50);
  if (typeof raw.km_per_year === "number") w.km_per_year = num(raw.km_per_year, 0, 0, 200_000);
  if (typeof raw.used_price_drift_pct === "number")
    w.used_price_drift_pct = num(raw.used_price_drift_pct, 0, -50, 50);
  if (raw.pay_mode === "cash" || raw.pay_mode === "loan") w.pay_mode = raw.pay_mode;
  return Object.keys(w).length ? w : null;
}

export function sanitizeOverrides(raw: unknown): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "string" && v.length <= 64) out[k] = v;
  }
  return out;
}

export function sanitizeState(raw: unknown): CarState {
  const r = isObj(raw) ? raw : {};
  const profile = sanitizeProfile(r.profile);
  return {
    profile,
    selection: sanitizeSelection(r.selection),
    whatIf: sanitizeWhatIf(r.whatIf),
    overrides: sanitizeOverrides(r.overrides),
    measure: oneOf(r.measure, MEASURES, profile.preferred_measure),
  };
}

// ---------------------------------------------------------------------------
// Codec: compact JSON (defaults omitted) -> base64url.

function stripDefaults(value: unknown, defaults: unknown): unknown {
  if (isObj(value) && isObj(defaults)) {
    const out: Json = {};
    for (const [k, v] of Object.entries(value)) {
      const stripped = stripDefaults(v, defaults[k]);
      if (stripped !== undefined) out[k] = stripped;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (JSON.stringify(value) === JSON.stringify(defaults)) return undefined;
  return value;
}

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Encode the state as one URL-safe token; "" when everything is default. */
export function encodeState(state: CarState): string {
  const compact = stripDefaults(state, DEFAULT_STATE);
  if (compact === undefined) return "";
  return toBase64Url(JSON.stringify(compact));
}

/** Decode a token from the URL. Garbage of any kind yields defaults; invalid
 * fields inside an otherwise valid token are dropped individually. */
export function decodeState(token: string | null | undefined): CarState {
  if (!token) return sanitizeState({});
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(token));
    return sanitizeState(parsed);
  } catch {
    return sanitizeState({});
  }
}

// ---------------------------------------------------------------------------
// localStorage persistence, wrapped so private mode / quota errors are silent.

export function loadState(): CarState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return sanitizeState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveState(state: CarState): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** Sum of the four exit odds; the Continue gate needs exactly 100. */
export const exitOddsSum = (o: ExitOdds): number => o.p12 + o.p24 + o.p36 + o.p48;
export const chargingSum = (c: ChargingMix): number => c.home_pct + c.work_free_pct + c.public_pct;

/** The exit point the user thinks most likely (ties -> earliest). */
export function mostLikelyExit(o: ExitOdds): ExitKey {
  let best: ExitKey = "p12";
  for (const k of EXIT_KEYS) if (o[k] > o[best]) best = k;
  return best;
}

/** Profile with the what-if values folded in (what "Save as my assumptions" does). */
export function applyWhatIf(profile: CarProfile, w: WhatIf | null): CarProfile {
  if (!w) return profile;
  return {
    ...profile,
    return_on_cash_pct: w.return_on_cash_pct ?? profile.return_on_cash_pct,
    km_per_year: w.km_per_year ?? profile.km_per_year,
    pay_mode: w.pay_mode ?? profile.pay_mode,
  };
}
