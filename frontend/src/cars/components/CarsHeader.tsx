// Header with the five-step nav (spec 022 R11). Steps 2 (Market) and 5
// (Checklist) are follow-up specs and render as disabled "coming soon".

import { NavLink, useLocation } from "react-router-dom";

import { isMockMode } from "../api";

export default function CarsHeader() {
  const { pathname } = useLocation();
  const onDetail = pathname.startsWith("/cars/option/");
  const onCompare = pathname.startsWith("/cars/compare");
  return (
    <header className="cars-header">
      <div className="cars-header__inner">
        <div className="cars-brand">
          <span className="cars-brand__name">Cars</span>
          <span className="cars-brand__sub">Car costs for newcomers to Norway</span>
          {isMockMode() && <span className="cars-brand__mock">Sample data</span>}
        </div>
        <nav aria-label="Steps" className="cars-steps">
          <NavLink to="/cars" end className="cars-steps__link">
            1 Your situation
          </NavLink>
          <span className="cars-steps__link cars-steps__link--soon" aria-disabled="true">
            2 Market <small>coming soon</small>
          </span>
          <NavLink
            to="/cars/compare"
            className="cars-steps__link"
            aria-current={onCompare ? "page" : undefined}
          >
            3 Compare
          </NavLink>
          {onDetail ? (
            <span className="cars-steps__link cars-steps__link--active" aria-current="page">
              4 Detail
            </span>
          ) : (
            <span className="cars-steps__link cars-steps__link--soon" aria-disabled="true" title="Open an option from Compare">
              4 Detail
            </span>
          )}
          <span className="cars-steps__link cars-steps__link--soon" aria-disabled="true">
            5 Checklist <small>coming soon</small>
          </span>
        </nav>
      </div>
    </header>
  );
}
