// Header with the five-step nav (spec 022 R11, 023 R3) and the product
// switcher (025 R7). Step 4 (Detail) is only reachable from an option, so it
// is a link only while on one.

import { useEffect, useRef } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

import LanguagePicker from "../../components/LanguagePicker";
import ProductSwitcher from "../../components/ProductSwitcher";
import { useT } from "../../i18n/react";
import { DRIVE_NAME, DRIVE_PATH, LANDING_PATH, drivePath } from "../../lib/productRoutes";
import { isMockMode } from "../api";

export default function CarsHeader() {
  const { t } = useT();
  const { pathname } = useLocation();
  const onDetail = pathname.startsWith(drivePath("/option/"));
  const onCompare = pathname.startsWith(drivePath("/compare"));
  // On a phone the steps scroll sideways (027 R4); keep the current one in view.
  const stepsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = stepsRef.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return;
    const right = current.offsetLeft + current.offsetWidth;
    if (right > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = right - nav.clientWidth;
    else if (current.offsetLeft < nav.scrollLeft) nav.scrollLeft = current.offsetLeft;
  }, [pathname]);
  return (
    <header className="cars-header">
      <div className="cars-header__inner">
        <div className="cars-brand">
          <Link to={LANDING_PATH} className="cars-brand__name" aria-label={t("common.backHome", { name: DRIVE_NAME })}>
            <img src="/brand/drivecheap-logo.svg" alt="" className="cars-brand__logo" />
          </Link>
          <span className="cars-brand__sub">{t("carsPlan.header.subtitle")}</span>
          {isMockMode() && <span className="cars-brand__mock">{t("carsPlan.header.sample")}</span>}
        </div>
        <div className="cars-header__tools">
          <ProductSwitcher current="drive" />
          <LanguagePicker />
        </div>
        <nav aria-label={t("carsPlan.header.steps")} className="cars-steps" ref={stepsRef}>
          <NavLink to={DRIVE_PATH} end className="cars-steps__link">
            {t("carsPlan.step.situation", { n: 1 })}
          </NavLink>
          <NavLink to={drivePath("/market")} className="cars-steps__link">
            {t("carsPlan.step.market", { n: 2 })}
          </NavLink>
          <NavLink
            to={drivePath("/compare")}
            className="cars-steps__link"
            aria-current={onCompare ? "page" : undefined}
          >
            {t("carsPlan.step.compare", { n: 3 })}
          </NavLink>
          {onDetail ? (
            <span className="cars-steps__link cars-steps__link--active" aria-current="page">
              {t("carsPlan.step.detail", { n: 4 })}
            </span>
          ) : (
            <span
              className="cars-steps__link cars-steps__link--soon"
              aria-disabled="true"
              title={t("carsPlan.step.detailHint")}
            >
              {t("carsPlan.step.detail", { n: 4 })}
            </span>
          )}
          <NavLink to={drivePath("/checklist")} className="cars-steps__link">
            {t("carsPlan.step.checklist", { n: 5 })}
          </NavLink>
        </nav>
      </div>
    </header>
  );
}
