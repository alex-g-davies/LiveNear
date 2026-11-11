// Fixture builder for the cars screens (spec 022). Produces a realistic,
// deterministic ScenarioResponse from a ScenarioRequest so tests and the
// `?mock=1` dev mode render without a backend. The cost model is a toy, but
// it keeps the engine's invariants that the UI relies on: integer øre,
// Σ display items == TCO at each exit, P10 <= P50 <= P90, expected between
// best and worst, and sensible reactions to what-if and override inputs.

import type {
  CohortsResponse,
  DisplayItem,
  ExitMonthKey,
  InputView,
  LineItemView,
  MarketFilters,
  MarketPointsResponse,
  MeasureResult,
  OptionResult,
  OptionSummary,
  RecommendRequest,
  RecommendResponse,
  RecommendRow,
  RuledOut,
  ScenarioRequest,
  ScenarioResponse,
  SensitivityRow,
  VehicleOut,
} from "../api";
import type { Measure, Mode } from "../lib/profile";

const CURRENT_YEAR = 2026;
const MOCK_INPUT_LABELS: Record<string, string> = {
  purchase_price: "Purchase price",
  resale_curve: "Resale at exit",
  loan_rate: "Loan rate",
  insurance_year_nok: "Insurance (per year)",
  rereg_fee_nok: "Re-registration fee",
  winter_tyres_nok: "Winter tyres",
  energy_price_nok_kwh: "Energy price",
  lease_rent: "Lease monthly payment",
};

const BUNDLE_AS_OF = "2026-10-24";
const MONTHS = 61;
const EXIT_MONTHS: ExitMonthKey[] = ["12", "24", "36", "48"];

const VEHICLES: VehicleOut[] = [
  {
    variant_id: "tesla-model3-lr-rwd",
    make: "Tesla",
    model: "Model 3",
    trim_group: "Long Range RWD",
    segment: "D",
    model_years: [2021, 2022, 2023, 2024, 2025, 2026],
    energy_type: "ev",
    drive: "rwd",
    body: "sedan",
    battery_kwh: "78.1",
    power_kw: 208,
    heat_pump: true,
    auto_precondition: true,
    range_km_wltp: 702,
    accel_0_100_s: "5.2",
    fun_score: "6.8",
    new_price_ore: 41_990_000,
    has_lease_offer: true,
  },
  {
    variant_id: "tesla-model3-perf-awd",
    make: "Tesla",
    model: "Model 3",
    trim_group: "Performance AWD",
    segment: "D",
    model_years: [2022, 2023, 2024, 2025, 2026],
    energy_type: "ev",
    drive: "awd",
    body: "sedan",
    battery_kwh: "78.1",
    power_kw: 343,
    heat_pump: true,
    auto_precondition: true,
    range_km_wltp: 528,
    accel_0_100_s: "3.1",
    fun_score: "9.1",
    new_price_ore: 54_990_000,
    has_lease_offer: true,
  },
  {
    variant_id: "renault-5-52",
    make: "Renault",
    model: "5",
    trim_group: "52 kWh",
    segment: "B",
    model_years: [2025, 2026],
    energy_type: "ev",
    drive: "fwd",
    body: "hatchback",
    battery_kwh: "52.0",
    power_kw: 110,
    heat_pump: true,
    auto_precondition: true,
    range_km_wltp: 410,
    accel_0_100_s: "8.0",
    fun_score: "6.0",
    new_price_ore: 29_990_000,
    has_lease_offer: true,
  },
  {
    variant_id: "hyundai-ioniq5-lr-awd",
    make: "Hyundai",
    model: "Ioniq 5",
    trim_group: "Long Range AWD",
    segment: "D",
    model_years: [2021, 2022, 2023, 2024, 2025, 2026],
    energy_type: "ev",
    drive: "awd",
    body: "crossover",
    battery_kwh: "84.0",
    power_kw: 239,
    heat_pump: true,
    auto_precondition: true,
    range_km_wltp: 546,
    accel_0_100_s: "5.3",
    fun_score: "6.2",
    new_price_ore: 51_990_000,
    has_lease_offer: true,
  },
  {
    variant_id: "kia-ev6-lr-rwd",
    make: "Kia",
    model: "EV6",
    trim_group: "Long Range RWD",
    segment: "D",
    model_years: [2021, 2022, 2023, 2024, 2025, 2026],
    energy_type: "ev",
    drive: "rwd",
    body: "crossover",
    battery_kwh: "84.0",
    power_kw: 168,
    heat_pump: true,
    auto_precondition: true,
    range_km_wltp: 582,
    accel_0_100_s: "7.7",
    fun_score: "6.5",
    new_price_ore: 47_990_000,
    has_lease_offer: false,
  },
  {
    variant_id: "mg4-xpower",
    make: "MG",
    model: "MG4",
    trim_group: "XPower",
    segment: "C",
    model_years: [2023, 2024, 2025, 2026],
    energy_type: "ev",
    drive: "awd",
    body: "hatchback",
    battery_kwh: "64.0",
    power_kw: 320,
    heat_pump: true,
    auto_precondition: false,
    range_km_wltp: 385,
    accel_0_100_s: "3.8",
    fun_score: "8.4",
    new_price_ore: 39_990_000,
    has_lease_offer: true,
  },
];

export function buildVehicles(): VehicleOut[] {
  return VEHICLES.map((v) => ({ ...v, model_years: [...v.model_years] }));
}

const NOK = (nok: number) => Math.round(nok * 100);

/** "rates.winter_tyres_nok" -> "Winter tyres": a readable fallback label with
 *  no config key or unit suffix on screen (027 R5). */
function humaniseId(id: string): string {
  const words = (id.split(".").pop() ?? id).replace(/_(nok|pct|ore)$/, "").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
const nbsp = " ";
const kr = (ore: number) =>
  `${String(Math.round(ore / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, nbsp)}${nbsp}kr`;

const AGE_FACTOR: Record<string, number> = {
  "18-24": 1.8,
  "25-29": 1.35,
  "30-39": 1.0,
  "40-49": 0.92,
  "50-64": 0.88,
  "65+": 0.95,
};

function numOverride(overrides: Record<string, string | number>, id: string): number | null {
  const v = overrides[id];
  if (v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

interface Ctx {
  req: ScenarioRequest;
  km: number;
  loanRate: number;
  ret: number;
  drift: number;
  payLoan: boolean;
  downOre: number;
  odds: Record<ExitMonthKey, number>;
}

function retention(ageYears: number, kmTotal: number): number {
  return 0.3 + 0.7 * Math.exp(-0.2 * ageYears) * Math.exp(-kmTotal / 400_000);
}

interface BuiltOption {
  summary: OptionSummary;
}

function buildOption(v: VehicleOut, mode: Mode, year: number, ctx: Ctx): BuiltOption {
  const { req, km, loanRate, ret, drift, payLoan, downOre, odds } = ctx;
  const ov = req.overrides;
  const P = v.new_price_ore ?? 40_000_000;
  const age0 = mode === "new" || mode === "lease" ? 0 : CURRENT_YEAR - year;
  const km0 = age0 * 15_000;
  const seller: "dealer" | "private" | null =
    mode === "used_1_3" ? "dealer" : mode === "used_5_plus" ? "private" : null;
  // Purchase price in øre.
  const ppOverride = numOverride(ov, "purchase_price");
  let pp = mode === "new" ? P : Math.round(P * retention(age0, km0) * (seller === "dealer" ? 1.03 : 1));
  if (ppOverride !== null) pp = NOK(ppOverride);

  // Running costs per month (øre).
  const ins = req.profile.insurance;
  const quote = req.profile.insurance_quotes_nok[v.variant_id];
  const insOverride = numOverride(ov, "insurance_year_nok");
  const insYearNok =
    insOverride ??
    quote ??
    Math.round(
      (9_000 + P / 100 / 60) *
        (AGE_FACTOR[ins.age_band] ?? 1) *
        (1 - 0.05 * Math.min(ins.claims_free_years, 6)) *
        (ins.has_claims_free_letter ? 0.9 : 1),
    );
  const insMonth = NOK(insYearNok / 12);
  const mix = req.profile.charging_mix;
  const priceOverride = numOverride(ov, "energy_price_nok_kwh");
  const kwhPrice =
    priceOverride ?? (1.5 * mix.home_pct + 0 * mix.work_free_pct + 5.5 * mix.public_pct) / 100;
  const energyMonth = NOK((km / 12) * 0.2 * kwhPrice);
  const tyresMonth = NOK((km / 12) * 0.08);
  const serviceMonth = NOK(mode === "lease" ? 0 : 250 + (v.power_kw ?? 150) * 0.4);
  const taxMonth = NOK(3_290 / 12);
  const winterTyres = NOK(numOverride(ov, "winter_tyres_nok") ?? 15_000);
  const reregFee = mode === "new" ? NOK(12_000) : mode === "lease" ? 0 : NOK(numOverride(ov, "rereg_fee_nok") ?? 3_000);
  const fees0 = mode === "lease" ? 0 : winterTyres + reregFee;

  const excess = Math.max(0, km - 15_000) / 15_000;
  const rent = NOK((P / 100) * 0.0175 * (1 + 0.3 * excess));
  const upfrontRent = 3 * rent;

  const loanPrincipal = payLoan ? Math.max(0, pp - downOre) : 0;
  const cashTied = payLoan ? Math.min(downOre, pp) : pp;

  const resaleAt = (t: number) =>
    Math.round(P * retention(age0 + t / 12, km0 + (km * t) / 12) * (1 + drift / 100));

  const display: Record<ExitMonthKey, DisplayItem[]> = { "12": [], "24": [], "36": [], "48": [] };
  const displayAt = (t: number): DisplayItem[] => {
    const yrs = t / 12;
    if (mode === "lease") {
      const penalty = t < 36 ? Math.round(rent * (36 - t) * 0.5) : Math.round(rent * excess * 2);
      return [
        { key: "rent", label: "Lease payments", ore: upfrontRent + rent * t },
        { key: "insurance", label: "Insurance", ore: insMonth * t },
        { key: "energy", label: "Energy", ore: energyMonth * t },
        { key: "tyres", label: "Tyres", ore: tyresMonth * t },
        { key: "fees_taxes", label: "Fees and taxes", ore: taxMonth * t },
        { key: "exit_cost", label: "Cost to exit", ore: penalty },
      ];
    }
    const resale = resaleAt(t);
    const interest = Math.round(loanPrincipal * (loanRate / 100) * yrs * 0.55);
    const opp = Math.round(cashTied * (ret / 100) * yrs);
    const friction = Math.round(resale * 0.02) + (req.profile.export_on_exit ? NOK(8_000) : 0);
    return [
      { key: "value_lost", label: "Value lost", ore: pp - resale },
      { key: "financing", label: "Financing", ore: interest + opp },
      { key: "insurance", label: "Insurance", ore: insMonth * t },
      { key: "energy", label: "Energy", ore: energyMonth * t },
      { key: "tyres", label: "Tyres", ore: tyresMonth * t },
      { key: "service", label: "Service", ore: serviceMonth * t },
      { key: "fees_taxes", label: "Fees and taxes", ore: fees0 + taxMonth * t },
      { key: "exit_cost", label: "Cost to exit", ore: friction },
    ];
  };

  const tco = new Array<number>(MONTHS).fill(0);
  const npc = new Array<number>(MONTHS).fill(0);
  const perMonth = new Array<number>(MONTHS).fill(0);
  const perKm = new Array<number>(MONTHS).fill(0);
  const cashUp = new Array<number>(MONTHS).fill(0);
  const kmAt = new Array<number>(MONTHS).fill(0);
  const resale = new Array<number>(MONTHS).fill(0);
  const displaySeries: Record<string, number[]> = {};
  const cashUpFront = mode === "lease" ? upfrontRent : cashTied + fees0;

  for (let t = 0; t < MONTHS; t++) {
    const items = displayAt(t);
    const total = items.reduce((s, i) => s + i.ore, 0);
    const opp = mode === "lease" ? 0 : Math.round(cashTied * (ret / 100) * (t / 12));
    tco[t] = total;
    npc[t] = Math.round((total - opp) * (1 - 0.03 * (t / 12)));
    perMonth[t] = t === 0 ? total : Math.round(total / t);
    perKm[t] = t === 0 ? 0 : Math.round(total / ((km * t) / 12));
    cashUp[t] = cashUpFront;
    kmAt[t] = Math.round(km0 + (km * t) / 12);
    resale[t] = mode === "lease" ? 0 : resaleAt(t);
    if (t === 12 || t === 24 || t === 36 || t === 48) display[String(t) as ExitMonthKey] = items;
    for (const it of items) (displaySeries[it.key] ??= new Array<number>(MONTHS).fill(0))[t] = it.ore;
  }

  const sigma = (t: number) => (mode === "lease" ? 0.02 : 0.05 + 0.04 * (t / 12));
  const measureResult = (det: number[], withBand: boolean): MeasureResult => {
    const p10 = det.map((d, t) => (withBand ? Math.round(d * (1 - 1.28 * sigma(t))) : d));
    const p90 = det.map((d, t) => (withBand ? Math.round(d * (1 + 1.28 * sigma(t))) : d));
    const p50 = [...det];
    const exp = (arr: number[]) =>
      Math.round(EXIT_MONTHS.reduce((s, k) => s + odds[k] * arr[Number(k)], 0));
    const active = EXIT_MONTHS.filter((k) => odds[k] > 0);
    let best = { month: Number(active[0] ?? "12"), value: p50[Number(active[0] ?? "12")] };
    let worst = { ...best };
    for (const k of active) {
      const m = Number(k);
      if (p50[m] < best.value) best = { month: m, value: p50[m] };
      if (p50[m] > worst.value) worst = { month: m, value: p50[m] };
    }
    return {
      band: { p10, p50, p90 },
      deterministic: det,
      expected: { p10: exp(p10), p50: exp(p50), p90: exp(p90) },
      expected_det: exp(det),
      best,
      worst,
    };
  };

  const measures: Record<Measure, MeasureResult> = {
    per_month: measureResult(perMonth, true),
    tco: measureResult(tco, true),
    npc: measureResult(npc, true),
    cash_up_front: measureResult(cashUp, false),
    per_km: measureResult(perKm, true),
  };

  // Inputs with provenance. Labels are filled from MOCK_INPUT_LABELS below so
  // each push stays short; the real API sends `label` on every input.
  type Unlabelled = Omit<InputView, "label"> & { label?: string };
  const inputs: Unlabelled[] = [];
  const tco36 = Math.max(1, tco[36]);
  const share = (key: string) => (display["36"].find((i) => i.key === key)?.ore ?? 0) / tco36;
  const withOverride = (id: string, base: Omit<Unlabelled, "id">): Unlabelled => {
    const o = ov[id];
    if (o === undefined) return { id, ...base };
    return {
      id,
      ...base,
      value: String(o),
      source: "Your override",
      as_of: BUNDLE_AS_OF,
      status: "live",
      basis: null,
    };
  };
  if (mode === "lease") {
    inputs.push({
      id: "lease_rent",
      value: `${kr(rent)} per month`,
      source: "Dealer lease quote, 36 months / 15 000 km",
      as_of: "2026-10-10",
      status: "live",
      basis: null,
      range: null,
      used_by: ["rent", "exit_cost"],
      share_of_tco: share("rent"),
      material: true,
    });
  } else {
    inputs.push(
      withOverride("purchase_price", {
        value: kr(pp),
        source: mode === "new" ? `${v.make} price list` : seller === "dealer" ? "Dealer listing" : "Private listing",
        as_of: "2026-10-15",
        status: "live",
        basis: null,
        range: null,
        used_by: ["value_lost", "financing"],
        share_of_tco: share("value_lost"),
        material: true,
      }),
      {
        id: "resale_curve",
        value: `${Math.round(retention(age0 + 3, km0 + km * 3) * 100)}${nbsp}% of new price after 3 yr`,
        source: "Depreciation curve for this model",
        as_of: BUNDLE_AS_OF,
        status: mode === "new" ? "live" : "estimate",
        basis: mode === "new" ? null : "Segment-pooled retention; fewer than 5 listings in this cohort",
        range: ["-12 %", "+8 %"],
        used_by: ["value_lost", "exit_cost"],
        share_of_tco: share("value_lost"),
        material: true,
      },
    );
    if (payLoan) {
      inputs.push(
        withOverride("loan_rate", {
          value: `${loanRate.toFixed(2).replace(".", ",")}${nbsp}% per year`,
          source: "Published car-loan rates (Finansportalen)",
          as_of: "2026-10-20",
          status: "live",
          basis: null,
          range: ["5,9 %", "8,4 %"],
          used_by: ["financing"],
          share_of_tco: share("financing"),
          material: false,
        }),
      );
    }
    inputs.push(
      withOverride("rereg_fee_nok", {
        value: kr(reregFee),
        source: mode === "new" ? "Dealer document fee" : "Skatteetaten",
        as_of: "2026-01-01",
        status: "live",
        basis: null,
        range: null,
        used_by: ["fees_taxes"],
        share_of_tco: share("fees_taxes"),
        material: false,
      }),
      withOverride("winter_tyres_nok", {
        value: kr(winterTyres),
        source: "Typical price for this tyre size",
        as_of: "2026-09-01",
        status: "estimate",
        basis: "Median of three tyre retailers for 18–19 inch studless sets",
        range: ["11 000 kr", "19 000 kr"],
        used_by: ["fees_taxes"],
        share_of_tco: share("fees_taxes"),
        material: false,
      }),
    );
  }
  inputs.push(
    withOverride("insurance_year_nok", {
      value: `${kr(NOK(insYearNok))} per year`,
      source: quote !== undefined ? "Your own quote" : "Default for your profile",
      as_of: BUNDLE_AS_OF,
      status: quote !== undefined || insOverride !== null ? "live" : "estimate",
      basis:
        quote !== undefined
          ? null
          : "Newcomer with no Norwegian claims history; scaled by age band and vehicle price",
      range: ["-25 %", "+40 %"],
      used_by: ["insurance"],
      share_of_tco: share("insurance"),
      material: share("insurance") > 0.15,
    }),
    withOverride("energy_price_nok_kwh", {
      value: `${kwhPrice.toFixed(2).replace(".", ",")}${nbsp}kr/kWh`,
      source: "Your charging mix × winter efficiency",
      as_of: BUNDLE_AS_OF,
      status: "estimate",
      basis: "Home 1,50 kr/kWh (NO1 spot + grid), public fast 5,50 kr/kWh",
      range: ["-20 %", "+30 %"],
      used_by: ["energy"],
      share_of_tco: share("energy"),
      material: false,
    }),
  );

  for (const i of inputs) i.label ??= MOCK_INPUT_LABELS[i.id] ?? humaniseId(i.id);
  const materialEstimates = inputs.filter((i) => i.material && i.status === "estimate").map((i) => i.id);
  const lineItems: LineItemView[] = display["36"].map((item) => ({
    key: item.key,
    label: item.label,
    group: item.key === "value_lost" || item.key === "exit_cost" ? "exit" : "cash",
    estimate: inputs.some((i) => i.used_by.includes(item.key) && i.status === "estimate"),
    used: inputs.filter((i) => i.used_by.includes(item.key)).map((i) => i.id),
    at_exit: {
      "12": display["12"].find((d) => d.key === item.key)?.ore ?? 0,
      "24": display["24"].find((d) => d.key === item.key)?.ore ?? 0,
      "36": display["36"].find((d) => d.key === item.key)?.ore ?? 0,
      "48": display["48"].find((d) => d.key === item.key)?.ore ?? 0,
    },
  }));

  const label = `${v.make} ${v.model} ${v.trim_group}`;
  const result: OptionResult = {
    option_id: `${v.variant_id}-${year}-${mode}`,
    label,
    mode,
    make: v.make,
    model: v.model,
    trim_group: v.trim_group,
    model_year: year,
    fun_score: v.fun_score,
    status: materialEstimates.length ? "estimate" : "live",
    material_estimates: materialEstimates,
    material_estimate_labels: inputs.filter((i) => materialEstimates.includes(i.id)).map((i) => i.label ?? i.id),
    cash_up_front: cashUpFront,
    km_at: kmAt,
    measures,
    line_items: lineItems,
    display,
    display_series: displaySeries,
    inputs: inputs as InputView[],
    purchase_price: mode === "lease" ? null : pp,
    resale_p50: mode === "lease" ? null : resale,
    resale_band:
      mode === "lease"
        ? null
        : {
            p10: resale.map((v, t) => Math.round(v * (1 - 1.28 * sigma(t)))),
            p50: [...resale],
            p90: resale.map((v, t) => Math.round(v * (1 + 1.28 * sigma(t)))),
          },
  };
  return {
    summary: {
      result,
      variant_id: v.variant_id,
      option_kind: mode,
      seller_type: seller,
      lease_offer_id: mode === "lease" ? `lease-${v.variant_id}-36` : null,
    },
  };
}

function pickYear(v: VehicleOut, mode: Mode, from: number, to: number): number | null {
  const years = v.model_years.filter((y) => y >= from && y <= to);
  if (!years.length) return null;
  const newest = Math.max(...years);
  if (mode === "new" || mode === "lease") return newest >= CURRENT_YEAR - 1 ? newest : null;
  if (mode === "used_1_3") {
    const ok = years.filter((y) => CURRENT_YEAR - y >= 1 && CURRENT_YEAR - y <= 3);
    return ok.length ? Math.max(...ok) : null;
  }
  const ok = years.filter((y) => CURRENT_YEAR - y >= 5);
  return ok.length ? Math.max(...ok) : null;
}

const MODE_WORD: Record<Mode, string> = {
  new: "new",
  lease: "lease",
  used_1_3: "used 1–3 yr",
  used_5_plus: "used 5+ yr",
};

export function buildScenario(req: ScenarioRequest): ScenarioResponse {
  const w = req.what_if ?? null;
  const profile = req.profile;
  const oddsRaw = profile.exit_odds;
  const sum = oddsRaw.p12 + oddsRaw.p24 + oddsRaw.p36 + oddsRaw.p48 || 100;
  const odds: Record<ExitMonthKey, number> = {
    "12": oddsRaw.p12 / sum,
    "24": oddsRaw.p24 / sum,
    "36": oddsRaw.p36 / sum,
    "48": oddsRaw.p48 / sum,
  };
  const loanOverride = numOverride(req.overrides, "loan_rate");
  const driftOverride = numOverride(req.overrides, "used_price_drift_pct");
  const ctx: Ctx = {
    req,
    km: w?.km_per_year ?? profile.km_per_year,
    loanRate: w?.loan_rate_pct ?? loanOverride ?? 6.5,
    ret: w?.return_on_cash_pct ?? Number(profile.return_on_cash_pct),
    drift: w?.used_price_drift_pct ?? driftOverride ?? 0,
    payLoan: (w?.pay_mode ?? (profile.pay_mode === "cash" ? "cash" : "loan")) === "loan",
    downOre: NOK(profile.down_payment_nok),
    odds,
  };

  const options: OptionSummary[] = [];
  const ruled: RuledOut[] = [];
  const skipped: string[] = [];
  const must = profile.limits.must_haves;
  const maxPrice = profile.limits.max_price_nok;

  for (const sel of req.selection) {
    const v = VEHICLES.find((x) => x.variant_id === sel.variant_id);
    if (!v) {
      skipped.push(`Unknown variant ${sel.variant_id} ignored`);
      continue;
    }
    const label = `${v.make} ${v.model} ${v.trim_group}`;
    const missing: string[] = [];
    if (must.includes("heat_pump") && !v.heat_pump) missing.push("no heat pump");
    if (must.includes("auto_precondition") && !v.auto_precondition)
      missing.push("no automatic battery preconditioning");
    if (must.includes("awd") && v.drive !== "awd") missing.push("not AWD");
    if (missing.length) {
      ruled.push({ option_id: `${v.variant_id}-any`, label, reasons: missing });
      continue;
    }
    for (const mode of profile.limits.modes) {
      if (mode === "lease" && !v.has_lease_offer) {
        skipped.push(`No lease offer on file for ${label}`);
        continue;
      }
      const year = pickYear(v, mode, sel.year_from, sel.year_to);
      if (year === null) {
        skipped.push(`No ${MODE_WORD[mode]} cohort for ${label} in model years ${sel.year_from}–${sel.year_to}`);
        continue;
      }
      const built = buildOption(v, mode, year, ctx);
      const price = built.summary.result.inputs.find((i) => i.id === "purchase_price");
      if (maxPrice !== null && mode !== "lease" && price) {
        const nok = Number(price.value.replace(/[^\d]/g, ""));
        if (nok > maxPrice) {
          ruled.push({
            option_id: built.summary.result.option_id,
            label: `${label} (${MODE_WORD[mode]})`,
            reasons: [`over your max price (${kr(nok * 100)})`],
          });
          continue;
        }
      }
      options.push(built.summary);
    }
  }

  const rank = req.measure;
  options.sort((a, b) => a.result.measures[rank].expected.p50 - b.result.measures[rank].expected.p50);

  const sensitivity: SensitivityRow[] = [];
  let sensitivityId: string | null = null;
  if (options.length) {
    const top = options[0].result;
    const m = top.measures[rank];
    const e = m.expected.p50;
    const scale = (f: number) => Math.round(e * f);
    sensitivity.push(
      { driver: "resale", label: "Resale value", low: scale(-0.14), high: scale(0.12), note: "Resale ±12 % around the curve" },
      {
        driver: "exit_timing",
        label: "When you leave",
        low: m.best.value - e,
        high: m.worst.value - e,
        note: "From your best to your worst exit point",
      },
      { driver: "insurance", label: "Insurance", low: scale(-0.05), high: scale(0.08), note: "Quote range for your profile" },
      { driver: "loan_rate", label: "Loan rate", low: scale(-0.02), high: scale(0.03), note: "5,9–8,4 % per year" },
    );
    sensitivityId = top.option_id;
  }

  const second = options[1]?.result.measures[rank].expected.p50;
  if (second !== undefined && options.length) {
    const gap = second - options[0].result.measures[rank].expected.p50;
    const pct = Math.min(45, Math.max(5, Math.round((gap / Math.max(1, options[0].result.measures[rank].expected.p50)) * 300)));
    sensitivity.push({
      driver: "swap",
      label: "Rank stability",
      low: 0,
      high: 0,
      note: `Top two options swap if resale value lands in its lower ${pct} %.`,
    });
  }

  return {
    ranking_measure: rank,
    exit_odds: odds,
    seed: req.seed,
    draws: req.draws,
    bundle_as_of: BUNDLE_AS_OF,
    start_date: profile.start_date ?? "2026-11-01",
    options,
    ruled_out: ruled,
    skipped,
    sensitivity,
    sensitivity_option_id: sensitivityId,
    elapsed_ms: 42,
  };
}

// ---- Recommendations (spec 024 R11): rank the whole fixture catalogue for the
// profile and tag each row the way the server does (each tag once).

export function buildRecommend(req: RecommendRequest): RecommendResponse {
  const selection = VEHICLES.map((v) => ({
    variant_id: v.variant_id,
    year_from: Math.min(...v.model_years),
    year_to: Math.max(...v.model_years),
  }));
  const sc = buildScenario({
    profile: req.profile,
    selection,
    what_if: null,
    overrides: {},
    measure: req.measure,
    seed: req.seed,
    draws: req.draws,
  });
  const m = req.measure;
  const options = sc.options;
  const reasons = new Map<string, string[]>(options.map((o) => [o.result.option_id, []]));
  const tag = (o: OptionSummary | undefined, reason: string) => {
    if (o) reasons.get(o.result.option_id)!.push(reason);
  };
  const by = (f: (o: OptionSummary) => number, pick: "min" | "max") =>
    options.reduce<OptionSummary | undefined>((best, o) => {
      if (!best) return o;
      const a = f(o);
      const b = f(best);
      return (pick === "min" ? a < b : a > b) ? o : best;
    }, undefined);
  tag(options[0], "lowest expected cost");
  tag(by((o) => o.result.measures[m].expected.p90 - o.result.measures[m].expected.p10, "min"), "narrowest uncertainty band");
  tag(by((o) => Number(o.result.fun_score), "max"), "best fun score");
  tag(by((o) => o.result.cash_up_front, "min"), "lowest cash up front");
  const n = Math.max(1, Math.min(10, req.n));
  const picked = [...options.slice(0, n), ...options.slice(n).filter((o) => reasons.get(o.result.option_id)!.length)];
  const rows: RecommendRow[] = picked.map((o) => ({
    rank: options.indexOf(o) + 1,
    reasons: reasons.get(o.result.option_id)!,
    summary: o,
  }));
  const ruled: Record<string, number> = {};
  for (const r of sc.ruled_out) for (const reason of r.reasons) ruled[reason] = (ruled[reason] ?? 0) + 1;
  return {
    ranking_measure: m,
    bundle_as_of: BUNDLE_AS_OF,
    start_date: sc.start_date,
    n_considered: options.length,
    ruled_out: ruled,
    skipped: sc.skipped.length,
    rows,
    elapsed_ms: 31,
  };
}

// ---- Market (spec 023 R1/R2): cohort points and per-listing points for the
// mock mode and the market screen tests. Deterministic (seeded PRNG), priced
// with the same toy retention model as the scenario builder.

function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hex16(text: string): string {
  // Two FNV-1a passes make a 16-hex, listing-id-shaped token (not a real hash).
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b ^ text.charCodeAt(text.length - 1 - i), 0x811c9dc5) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

function cohortSeed(v: VehicleOut, year: number): { refKm: number; valueOre: number; n: number } {
  const age0 = Math.max(0, CURRENT_YEAR - year);
  const refKm = age0 === 0 ? 5_000 : age0 * 15_000;
  const P = v.new_price_ore ?? 40_000_000;
  const valueOre = Math.round(P * retention(age0, refKm));
  const rnd = lcg(hex16(`${v.variant_id}:${year}`).length + year * 31 + v.variant_id.length * 7);
  return { refKm, valueOre, n: 8 + Math.floor(rnd() * 8) };
}

function meetsMustHaves(v: VehicleOut, mustHaves: string[]): boolean {
  return mustHaves.every(
    (m) => (m === "heat_pump" && v.heat_pump) || (m === "auto_precondition" && v.auto_precondition) || (m === "awd" && v.drive === "awd"),
  );
}

function marketVehicles(f: MarketFilters): VehicleOut[] {
  return VEHICLES.filter(
    (v) =>
      (!f.make || v.make.toLowerCase() === f.make.toLowerCase()) &&
      (!f.energy_type || f.energy_type.includes(v.energy_type)),
  );
}

export function buildCohorts(f: MarketFilters = {}): CohortsResponse {
  const cohorts: CohortsResponse["cohorts"] = [];
  let total = 0;
  for (const v of marketVehicles(f)) {
    for (const year of v.model_years) {
      if (year < (f.year_from ?? 2010) || year > (f.year_to ?? 2030)) continue;
      const c = cohortSeed(v, year);
      total += c.n;
      if (f.max_price_nok !== undefined && c.valueOre > f.max_price_nok * 100) continue;
      cohorts.push({
        cohort_id: `${v.variant_id}:${year}`,
        variant_id: v.variant_id,
        make: v.make,
        model: v.model,
        trim_group: v.trim_group,
        model_year: year,
        energy_type: v.energy_type,
        drive: v.drive,
        body: v.body,
        n_listings: c.n,
        ref_km: c.refKm,
        value_ref_ore: c.valueOre,
        pi_low_ore: Math.round(c.valueOre * 0.92),
        pi_high_ore: Math.round(c.valueOre * 1.08),
        status: c.n >= 5 ? "live" : "estimate",
        as_of: BUNDLE_AS_OF,
        range_km_wltp: v.range_km_wltp,
        efficiency_wh_per_km: 150 + Math.round((v.power_kw ?? 150) / 10),
        accel_0_100_s: v.accel_0_100_s,
        meets_must_haves: meetsMustHaves(v, f.must_have ?? []),
      });
    }
  }
  return { bundle_as_of: BUNDLE_AS_OF, listings_mode: "fixture", n_listings_total: total, cohorts };
}

export function buildMarketPoints(f: MarketFilters = {}): MarketPointsResponse {
  const points: MarketPointsResponse["points"] = [];
  for (const v of marketVehicles(f)) {
    if (f.must_have?.length && !meetsMustHaves(v, f.must_have)) continue;
    for (const year of v.model_years) {
      if (year < (f.year_from ?? 2010) || year > (f.year_to ?? 2030)) continue;
      const c = cohortSeed(v, year);
      const rnd = lcg(year * 1009 + v.variant_id.length * 97 + c.n);
      for (let i = 0; i < c.n; i++) {
        const km = Math.max(10, Math.round((c.refKm * Math.exp((rnd() - 0.5) * 0.9)) / 100) * 100);
        const dealer = rnd() < 0.5;
        const ask = Math.round(c.valueOre * (1 - 0.1 * Math.log((km + 10_000) / (c.refKm + 10_000))) * (dealer ? 1.03 : 1) * (0.93 + rnd() * 0.14));
        if (f.max_price_nok !== undefined && ask > f.max_price_nok * 100) continue;
        points.push({
          listing_id: hex16(`${v.variant_id}:${year}:${i}`),
          variant_id: v.variant_id,
          cohort_id: `${v.variant_id}:${year}`,
          model_year: year,
          ask_ore: ask,
          km,
          seller_type: dealer ? "dealer" : "private",
          first_reg_month: `${year}-${String(1 + Math.floor(rnd() * 12)).padStart(2, "0")}`,
          snapshot_date: BUNDLE_AS_OF,
        });
      }
    }
  }
  return { bundle_as_of: BUNDLE_AS_OF, listings_mode: "fixture", n_points: points.length, points };
}
