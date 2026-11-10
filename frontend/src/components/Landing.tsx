// Landing page (spec 025 R11): names both products and what each is for. It
// stays free of map and car code so it loads fast; hovering a card fetches
// that product ahead of the click (R6).

import { Link } from "react-router-dom";

import { DRIVE_NAME, MAP_NAME, SITE_NAME, driveHref, loadDriveApp, loadMapApp, mapHref } from "../lib/productRoutes";

function ContourArt() {
  return (
    <svg className="landing-card__art" viewBox="0 0 320 120" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <rect width="320" height="120" fill="var(--accent-soft)" />
      <path d="M0 78 96 56l44 64H0Z" fill="#c6dbef" />
      <path d="M96 56 214 34l48 86H140Z" fill="#9ecae1" />
      <path d="m214 34 106-18v104h-58Z" fill="#6baed6" />
      <g fill="none" stroke="var(--accent)">
        <ellipse cx="160" cy="64" rx="112" ry="48" strokeOpacity=".35" strokeWidth="1.5" />
        <ellipse cx="160" cy="64" rx="72" ry="31" strokeOpacity=".6" strokeWidth="1.5" />
        <ellipse cx="160" cy="64" rx="34" ry="15" strokeWidth="2" />
      </g>
      <circle cx="160" cy="64" r="6" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
    </svg>
  );
}

function CostCurveArt() {
  return (
    <svg className="landing-card__art" viewBox="0 0 320 120" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <rect width="320" height="120" fill="var(--accent-soft)" />
      <g stroke="var(--surface)" strokeWidth="1.5">
        <path d="M0 30h320M0 60h320M0 90h320" />
        <path d="M80 0v120M160 0v120M240 0v120" />
      </g>
      <path d="M0 22C70 72 140 88 320 94" fill="none" stroke="#9ecae1" strokeWidth="3" />
      <path d="M0 48C80 58 170 44 320 16" fill="none" stroke="#6baed6" strokeWidth="3" strokeDasharray="7 6" />
      <path d="M0 36C60 76 150 72 320 58" fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" />
      <circle cx="200" cy="66" r="6" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
    </svg>
  );
}

export default function Landing() {
  return (
    <div className="landing">
      <main className="landing__inner">
        <header className="landing__head">
          <h1 className="landing__title">{SITE_NAME}</h1>
          <p className="landing__lede">Weigh up where to live and what to drive before you commit.</p>
        </header>
        <div className="landing__cards">
          <Link to={mapHref()} className="landing-card" onMouseEnter={() => void loadMapApp()} onFocus={() => void loadMapApp()}>
            <ContourArt />
            <span className="landing-card__body">
              <img src="/brand/livenear-logo.svg" alt={MAP_NAME} className="landing-card__logo" />
              <span className="landing-card__text">Find where you can afford a home and still reach work.</span>
              <span className="landing-card__coverage">Home values and commute times · United States and Norway</span>
              <span className="landing-card__cta">Explore the map →</span>
            </span>
          </Link>
          <Link to={driveHref()} className="landing-card" onMouseEnter={() => void loadDriveApp()} onFocus={() => void loadDriveApp()}>
            <CostCurveArt />
            <span className="landing-card__body">
              <img src="/brand/drivecheap-logo.svg" alt={DRIVE_NAME} className="landing-card__logo" />
              <span className="landing-card__text">See what a car will really cost you, from purchase to sale.</span>
              <span className="landing-card__coverage">Total cost of ownership · Norway</span>
              <span className="landing-card__cta">Compare car costs →</span>
            </span>
          </Link>
        </div>
      </main>
    </div>
  );
}
