// "Your assumptions" chip row on the Compare screens, with an Edit link back
// to the form.

import { Link } from "react-router-dom";

import { formatKm, formatPct } from "../lib/format";
import { useCarState } from "../state";
import { hasKey, tDynamic } from "../../i18n/core";
import { useT } from "../../i18n/react";
import { DRIVE_PATH } from "../../lib/productRoutes";

const mustLabel = (m: string): string =>
  hasKey(`carsPlan.chips.must.${m}`) ? tDynamic(`carsPlan.chips.must.${m}`) : m;

export default function AssumptionChips() {
  const { t } = useT();
  const { state } = useCarState();
  const { profile, selection, whatIf } = state;
  const o = profile.exit_odds;
  const c = profile.charging_mix;
  const km = whatIf?.km_per_year ?? profile.km_per_year;
  const payMode = whatIf?.pay_mode ?? profile.pay_mode;
  const variants = new Set(selection.map((s) => s.variant_id)).size;
  return (
    <div className="cars-chips" aria-label={t("carsPlan.chips.label")}>
      <Link to={DRIVE_PATH} className="cars-chip cars-chip--link">
        {t("carsPlan.chips.selection", { count: variants })}
      </Link>
      <span className="cars-chip">
        {t("carsPlan.chips.hold", { p12: o.p12, p24: o.p24, p36: o.p36, p48: o.p48, from: 1, to: 4 })}
      </span>
      <span className="cars-chip">{t("carsPlan.chips.km", { km: formatKm(km) })}</span>
      <span className="cars-chip">
        {t("carsPlan.chips.charging", { home: c.home_pct, work: c.work_free_pct, public: c.public_pct })}
      </span>
      {payMode !== "cash" && (
        <span className="cars-chip">
          {whatIf?.loan_rate_pct !== undefined
            ? t("carsPlan.chips.loanAt", { rate: formatPct(whatIf.loan_rate_pct, 2) })
            : t("carsPlan.chips.loan")}
          {payMode === "both" ? ` ${t("carsPlan.chips.andCash")}` : ""}
        </span>
      )}
      {payMode === "cash" && <span className="cars-chip">{t("carsPlan.chips.cash")}</span>}
      {profile.limits.must_haves.length > 0 && (
        <span className="cars-chip">
          {t("carsPlan.chips.mustHave", { list: profile.limits.must_haves.map(mustLabel).join(", ") })}
        </span>
      )}
      {whatIf && <span className="cars-chip cars-chip--whatif">{t("carsPlan.chips.whatIf")}</span>}
      <Link to={DRIVE_PATH} className="cars-chips__edit">
        {t("carsPlan.chips.edit")}
      </Link>
    </div>
  );
}
