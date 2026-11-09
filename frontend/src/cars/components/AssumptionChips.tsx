// "Your assumptions" chip row on the Compare screens, with an Edit link back
// to the form.

import { Link } from "react-router-dom";

import { formatKm, formatPct } from "../lib/format";
import { useCarState } from "../state";
import { DRIVE_PATH } from "../../lib/productRoutes";

const MUST_LABEL: Record<string, string> = {
  heat_pump: "heat pump",
  auto_precondition: "auto preconditioning",
  awd: "AWD",
};

export default function AssumptionChips() {
  const { state } = useCarState();
  const { profile, selection, whatIf } = state;
  const o = profile.exit_odds;
  const c = profile.charging_mix;
  const km = whatIf?.km_per_year ?? profile.km_per_year;
  const payMode = whatIf?.pay_mode ?? profile.pay_mode;
  const variants = new Set(selection.map((s) => s.variant_id)).size;
  return (
    <div className="cars-chips" aria-label="Your assumptions">
      <Link to={DRIVE_PATH} className="cars-chip cars-chip--link">
        Selection: {variants} {variants === 1 ? "car" : "cars"}
      </Link>
      <span className="cars-chip">
        Hold: {o.p12}/{o.p24}/{o.p36}/{o.p48}{" "}% over 1–4 yr
      </span>
      <span className="cars-chip">{formatKm(km)} per year</span>
      <span className="cars-chip">
        Charging: {c.home_pct}/{c.work_free_pct}/{c.public_pct}{" "}% home/work/public
      </span>
      {payMode !== "cash" && (
        <span className="cars-chip">
          Loan{whatIf?.loan_rate_pct !== undefined ? ` at ${formatPct(whatIf.loan_rate_pct, 2)}` : ""}
          {payMode === "both" ? " (and cash)" : ""}
        </span>
      )}
      {payMode === "cash" && <span className="cars-chip">Paying cash</span>}
      {profile.limits.must_haves.length > 0 && (
        <span className="cars-chip">
          Must have: {profile.limits.must_haves.map((m) => MUST_LABEL[m] ?? m).join(", ")}
        </span>
      )}
      {whatIf && <span className="cars-chip cars-chip--whatif">What-if active</span>}
      <Link to={DRIVE_PATH} className="cars-chips__edit">
        Edit
      </Link>
    </div>
  );
}
