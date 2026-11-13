// Keyed backend labels in the site language (spec 028 R6). The backend sends
// an English label beside each key; we look the key up and fall back to that
// label, so a new backend item never shows blank or as a raw key.

import { getLang, hasKey, tDynamic } from "./core";

function keyed(key: string, fallback: string): string {
  if (getLang() === "en" && fallback) return fallback;
  return hasKey(key) ? tDynamic(key) : fallback;
}

/** A cost line on the results ("Value lost", "Insurance" …). */
export function displayLabel(key: string, fallback: string): string {
  return keyed(`backend.display.${key}`, fallback);
}

/** A schedule item ("Where the money goes"). */
export function itemLabel(key: string, fallback: string): string {
  return keyed(`backend.item.${key}`, fallback);
}

/** An input, by its dotted id, mirroring `input_label` in engine/result.py. */
export function inputLabel(inputId: string, fallback: string): string {
  if (getLang() === "en" && fallback) return fallback;
  const tail = inputId.split(".").pop() ?? inputId;
  if (hasKey(`backend.input.${tail}`)) return tDynamic(`backend.input.${tail}`);
  const suffix = INPUT_KEYS.find((key) => tail.endsWith(key));
  if (suffix) return tDynamic(`backend.input.${suffix}`);
  if (tail.startsWith("traffic_tax")) return tDynamic("backend.rule.traffic_tax");
  if (tail.startsWith("re_registration")) return tDynamic("backend.rule.re_registration");
  if (tail.includes("periodic_inspection")) return tDynamic("backend.rule.periodic_inspection");
  return fallback;
}

/** A material-estimate entry: an input id or `item:<key>`. */
export function materialLabel(materialId: string, fallback: string): string {
  if (materialId.startsWith("item:")) return itemLabel(materialId.slice(5), fallback);
  return inputLabel(materialId, fallback);
}

// Same order as INPUT_LABELS, so suffix matching picks the same entry.
const INPUT_KEYS = [
  "price", "fees", "delivery_months", "loan_rate", "loan_establishment_fee", "loan_monthly_fee",
  "exit_friction_pct", "insurance_annual", "efficiency", "fuel_use", "winter_factor", "tyre_set", "tyre_life_km",
  "service_price", "service_first_price", "service_price_after_7y", "wear_per_year", "repair_allowance",
  "repair_ev_factor", "repair_in_warranty_factor", "inspection_fee", "wheel_change", "toll_offpeak",
  "toll_rush", "toll_ring", "toll_petrol_offpeak", "toll_petrol_rush", "toll_diesel_offpeak",
  "toll_diesel_rush", "fun_score", "new_price", "resale_path", "resale_retention", "lease_monthly",
  "lease_upfront", "lease_fees", "lease_km_cap", "lease_excess_km_fee", "lease_end_fee", "early_exit_pct",
  "early_exit_recovery", "early_exit_table", "charging_home", "charging_public", "home_ore_per_kwh",
  "public_ore_per_kwh", "fuel_petrol", "fuel_diesel", "petrol_ore_per_litre", "diesel_ore_per_litre",
  "monthly", "upfront", "km_cap", "excess_km_fee", "end_fee", "dealer_premium",
  "ask_to_sale_discount", "used_price_drift", "rental_per_month", "materiality_threshold",
];
