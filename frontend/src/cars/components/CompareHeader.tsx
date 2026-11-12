// Title row shared by the two Compare views: blurb for the active measure,
// snapshot date, Table / Curves toggle and the assumptions chips.

import { Link, NavLink } from "react-router-dom";

import EnglishText from "../../components/EnglishText";
import { useT } from "../../i18n/react";
import { formatDate } from "../lib/format";
import { measureDef, measureInSentence } from "../lib/measures";
import { useCarState } from "../state";
import AssumptionChips from "./AssumptionChips";
import { drivePath } from "../../lib/productRoutes";

interface Props {
  view: "table" | "curves";
}

export default function CompareHeader({ view }: Props) {
  const { t } = useT();
  const { state, scenario } = useCarState();
  const def = measureDef(state.measure);
  return (
    <>
      <div className="cars-titlebar">
        <div className="cars-titlebar__text">
          <h1 className="cars-h1">{t("carsCompare.header.title")}</h1>
          <p className="cars-lede">
            {view === "table"
              ? def.blurb
              : t("carsCompare.header.curvesLede", { measure: measureInSentence(def) })}
          </p>
        </div>
        <div className="cars-titlebar__tools">
          <span className="cars-hint">
            {t("carsCompare.header.pricesAsOf", { date: formatDate(scenario.data?.bundle_as_of) })}
            {scenario.loading && <span className="cars-hint__loading"> · {t("carsCompare.updating")}</span>}
          </span>
          <Link to={drivePath("/market")} className="cars-btn cars-btn--outline cars-btn--sm">
            {t("carsCompare.header.editSelection")}
          </Link>
          <div role="group" aria-label={t("carsCompare.header.view")} className="cars-seg">
            <NavLink to={drivePath("/compare")} end className="cars-seg__btn">
              {t("carsCompare.header.table")}
            </NavLink>
            <NavLink to={drivePath("/compare/curves")} className="cars-seg__btn">
              {t("carsCompare.header.curves")}
            </NavLink>
          </div>
        </div>
      </div>
      <AssumptionChips />
      {scenario.error && (
        <div className="status status--error" role="alert">
          {t("carsCompare.scenarioError")} <EnglishText>{scenario.error}</EnglishText>
          {scenario.data ? ` ${t("carsCompare.lastGood")}` : ""}
        </div>
      )}
    </>
  );
}
