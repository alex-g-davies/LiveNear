import { useEffect, useRef, useState } from "react";

import { BRAND_NAME } from "../config";
import type { TKey } from "../i18n/core";
import { useT } from "../i18n/react";
import { formatMonthYear } from "../lib/format";
import { rich } from "../lib/rich";

// `name` is a proper name, or a key where the credit has words in it.
interface Source {
  id: string;
  name: string | { key: TKey; license?: string };
  role: TKey;
  href: string;
}

const SOURCES: Source[] = [
  { id: "zillow", name: "Zillow ZHVI", role: "map.about.role.zillow", href: "https://www.zillow.com/research/data/" },
  { id: "census", name: "U.S. Census Bureau", role: "map.about.role.census", href: "https://www.census.gov/" },
  { id: "redfin", name: "Redfin Data Center", role: "map.about.role.redfin", href: "https://www.redfin.com/news/data-center/" },
  { id: "geonames", name: "GeoNames (CC BY 4.0)", role: "map.about.role.geonames", href: "https://www.geonames.org/" },
  { id: "wikipedia", name: "Wikipedia (CC BY-SA 4.0)", role: "map.about.role.wikipedia", href: "https://en.wikipedia.org/" },
  { id: "carto", name: { key: "map.about.name.carto" }, role: "map.about.role.carto", href: "https://carto.com/attribution/" },
  { id: "mapbox", name: "Mapbox", role: "map.about.role.mapbox", href: "https://www.mapbox.com/" },
];

// Norway (026 R19). SSB and Kartverket require credit under CC BY 4.0, and SSB
// requires saying the figures were changed; Oslo's bank is listed under NLOD.
const NORWAY_SOURCES: Source[] = [
  { id: "ssb", name: { key: "map.about.name.ssb", license: "CC BY 4.0" }, role: "map.about.role.ssb", href: "https://www.ssb.no/en/diverse/lisens" },
  { id: "oslo", name: { key: "map.about.name.oslo", license: "NLOD 2.0" }, role: "map.about.role.oslo", href: "https://statistikkbanken.oslo.kommune.no/" },
  { id: "kartverket", name: "Kartverket / Geonorge, CC BY 4.0", role: "map.about.role.kartverket", href: "https://www.geonorge.no/" },
];

interface Props {
  /** Reopens the welcome modal (017 R1). */
  onShowIntro?: () => void;
  /** ISO vintage of the loaded housing values (`as_of`), shown next to the
   * Zillow credit; omitted/unparseable hides it. */
  asOf?: string | null;
}

/** About & data popover (012 R5): every source credited in one place, plus
 * the estimates-not-advice disclaimer. */
export default function AboutPanel({ onShowIntro, asOf }: Props) {
  const { t } = useT();
  const vintage = formatMonthYear(asOf);
  const [open, setOpen] = useState(false);
  const name = (s: Source) => (typeof s.name === "string" ? s.name : t(s.name.key, { license: s.name.license ?? "" }));
  // Keyboard users land inside the dialog instead of on the panel behind it.
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button type="button" className="about-trigger" onClick={() => setOpen(true)}>
        {t("map.about.trigger")}
      </button>
      {open && (
        <div
          className="about"
          role="dialog"
          aria-modal="true"
          aria-label={t("map.about.label", { brand: BRAND_NAME })}
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="about__card">
            <header className="about__head">
              <h2 className="about__title">{t("map.about.title", { brand: BRAND_NAME })}</h2>
              <button
                type="button"
                ref={closeRef}
                className="about__close"
                aria-label={t("map.close")}
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>
            <p className="about__blurb">
              {rich(t("map.about.blurb", { brand: BRAND_NAME }), {
                advice: <strong>{t("map.about.notAdvice")}</strong>,
              })}
            </p>
            <h3 className="about__subhead">{t("map.about.sources")}</h3>
            <ul className="about__sources">
              {SOURCES.map((s) => (
                <li key={s.id}>
                  <a href={s.href} target="_blank" rel="noopener noreferrer">
                    {name(s)}
                  </a>{" "}
                  — {t(s.role, { min: 10 })}
                  {vintage && s.id === "zillow" && (
                    <span className="about__vintage"> {t("map.about.vintage", { date: vintage })}</span>
                  )}
                </li>
              ))}
            </ul>
            <h3 className="about__subhead">{t("map.region.no")}</h3>
            <ul className="about__sources">
              {NORWAY_SOURCES.map((s) => (
                <li key={s.id}>
                  <a href={s.href} target="_blank" rel="noopener noreferrer">
                    {name(s)}
                  </a>{" "}
                  — {t(s.role, { min: 10 })}
                </li>
              ))}
            </ul>
            <p className="about__foot">{t("map.about.noEndorse", { brand: BRAND_NAME })}</p>
            {onShowIntro && (
              <p className="about__foot">
                <button
                  type="button"
                  className="about__intro-link"
                  onClick={() => {
                    setOpen(false);
                    onShowIntro();
                  }}
                >
                  {t("map.about.howItWorks")}
                </button>
              </p>
            )}
            <p className="about__foot">
              {t("map.about.code", { license: "AGPL-3.0" })} ·{" "}
              <a
                href="https://github.com/alex-g-davies/LiveNear"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("map.about.github")}
              </a>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
