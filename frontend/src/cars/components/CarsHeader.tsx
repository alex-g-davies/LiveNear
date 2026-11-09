// Header with the five-step nav (spec 022 R11, 023 R3) and the product
// switcher (025 R7). Step 4 (Detail) is only reachable from an option, so it
// is a link only while on one.

import { Link, NavLink, useLocation } from "react-router-dom";

import ProductSwitcher from "../../components/ProductSwitcher";
import { DRIVE_NAME, DRIVE_PATH, LANDING_PATH, drivePath } from "../../lib/productRoutes";
import { isMockMode } from "../api";

export default function CarsHeader() {
  const { pathname } = useLocation();
  const onDetail = pathname.startsWith(drivePath("/option/"));
  const onCompare = pathname.startsWith(drivePath("/compare"));
  return (
    <header className="cars-header">
      <div className="cars-header__inner">
        <div className="cars-brand">
          <Link to={LANDING_PATH} className="cars-brand__name" aria-label={`${DRIVE_NAME}, back to home`}>
            <img src="/brand/drivecheap-logo.svg" alt="" className="cars-brand__logo" />
          </Link>
          <span className="cars-brand__sub">Car costs for newcomers to Norway</span>
          {isMockMode() && <span className="cars-brand__mock">Sample data</span>}
        </div>
        <ProductSwitcher current="drive" />
        <nav aria-label="Steps" className="cars-steps">
          <NavLink to={DRIVE_PATH} end className="cars-steps__link">
            1 Your situation
          </NavLink>
          <NavLink to={drivePath("/market")} className="cars-steps__link">
            2 Market
          </NavLink>
          <NavLink
            to={drivePath("/compare")}
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
          <NavLink to={drivePath("/checklist")} className="cars-steps__link">
            5 Checklist
          </NavLink>
        </nav>
      </div>
    </header>
  );
}
