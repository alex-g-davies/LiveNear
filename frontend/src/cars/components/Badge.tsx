// Live / Estimate badge (spec 022 R5/R11). The tooltip lists the material
// estimates behind an Estimate badge so the status is never a bare word.

import type { Status } from "../api";

interface Props {
  status: Status;
  /** Material estimate input ids (shown in the tooltip). */
  estimates?: string[];
}

export function humanizeId(id: string): string {
  const known: Record<string, string> = {
    purchase_price: "Purchase price",
    resale_curve: "Resale at exit",
    loan_rate: "Loan rate",
    insurance_year_nok: "Insurance",
    rereg_fee_nok: "Re-registration fee",
    winter_tyres_nok: "Winter tyres",
    energy_price_nok_kwh: "Energy price",
    lease_rent: "Lease rent",
  };
  if (known[id]) return known[id];
  const words = id.replace(/_nok$|_pct$|_kwh$/g, "").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function Badge({ status, estimates = [] }: Props) {
  const title =
    status === "live"
      ? "Every key input pulled from a dated source."
      : estimates.length
        ? `Estimated: ${estimates.map(humanizeId).join(", ")}`
        : "At least one key input is modelled or a default.";
  return (
    <span className={`cars-badge cars-badge--${status}`} title={title}>
      {status === "live" ? "Live" : "Estimate"}
    </span>
  );
}
