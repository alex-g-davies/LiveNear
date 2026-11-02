// Title row shared by the two Compare views: blurb for the active measure,
// snapshot date, Table / Curves toggle and the assumptions chips.

import { Link, NavLink } from "react-router-dom";

import { measureDef } from "../lib/measures";
import { useCarState } from "../state";
import AssumptionChips from "./AssumptionChips";

interface Props {
  view: "table" | "curves";
}

export default function CompareHeader({ view }: Props) {
  const { state, scenario } = useCarState();
  const def = measureDef(state.measure);
  return (
    <>
      <div className="cars-titlebar">
        <div className="cars-titlebar__text">
          <h1 className="cars-h1">Compare options</h1>
          <p className="cars-lede">
            {view === "table"
              ? def.blurb
              : `How each option's ${def.label.toLowerCase()} changes with how long you keep it.`}
          </p>
        </div>
        <div className="cars-titlebar__tools">
          <span className="cars-hint">
            Prices as of {scenario.data?.bundle_as_of ?? "—"}
            {scenario.loading && <span className="cars-hint__loading"> · updating…</span>}
          </span>
          <Link to="/cars/market" className="cars-btn cars-btn--outline cars-btn--sm">
            Edit selection
          </Link>
          <div role="group" aria-label="View" className="cars-seg">
            <NavLink to="/cars/compare" end className="cars-seg__btn">
              Table
            </NavLink>
            <NavLink to="/cars/compare/curves" className="cars-seg__btn">
              Curves
            </NavLink>
          </div>
        </div>
      </div>
      <AssumptionChips />
      {scenario.error && (
        <div className="status status--error" role="alert">
          Could not compute the scenario: {scenario.error}
          {scenario.data ? " — showing the last good result." : ""}
        </div>
      )}
    </>
  );
}
