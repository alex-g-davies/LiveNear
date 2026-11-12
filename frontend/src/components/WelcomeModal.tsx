import { useEffect, useRef } from "react";

import { BRAND_NAME } from "../config";
import type { TKey } from "../i18n/core";
import { useT } from "../i18n/react";
import type { BudgetSpec } from "../lib/affordability";
import type { Locale } from "../lib/locale";
import { rich } from "../lib/rich";
import BudgetInput from "./BudgetInput";

const HOW_TOS: { icon: string; text: TKey }[] = [
  { icon: "💰", text: "map.welcome.step.budget" },
  { icon: "📍", text: "map.welcome.step.pin" },
  { icon: "👆", text: "map.welcome.step.explore" },
];

interface Props {
  onClose: () => void;
  /** Optional budget capture (new-user onboarding): when wired, a first-timer
   * can set the budget here — as a price or a monthly payment (020) — and
   * land on an already-personalized map instead of having to re-find the
   * field in the panel. */
  budgetSpec?: BudgetSpec;
  onBudgetChange?: (spec: BudgetSpec) => void;
  locale?: Locale;
}

/** First-visit welcome modal (017 R1): what the site is and the three moves
 * that matter. App owns visibility + the localStorage dismissal flag; the
 * About panel's "How it works" link reopens it. */
export default function WelcomeModal({ onClose, budgetSpec, onBudgetChange, locale }: Props) {
  // Keyboard users land inside the dialog instead of on the map behind it.
  const { t } = useT();
  const ctaRef = useRef<HTMLButtonElement>(null);
  useEffect(() => ctaRef.current?.focus(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="about welcome"
      role="dialog"
      aria-modal="true"
      aria-label={t("map.welcome.label", { brand: BRAND_NAME })}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="about__card welcome__card">
        <header className="about__head">
          {/* The slogan banner, not the plain wordmark — this is the one
              landing surface where the tagline earns its space (018 R2). */}
          <img src="/brand/livenear-logo.svg" alt={BRAND_NAME} className="welcome__logo" />
          <button type="button" className="about__close" aria-label={t("map.close")} onClick={onClose}>
            ×
          </button>
        </header>
        <p className="about__blurb">
          {rich(t("map.welcome.blurb", { brand: BRAND_NAME }), {
            and: <em>{t("map.welcome.and")}</em>,
          })}
        </p>
        <ul className="welcome__steps">
          {HOW_TOS.map((h) => (
            <li key={h.icon}>
              <span className="welcome__icon" aria-hidden="true">
                {h.icon}
              </span>
              {t(h.text)}
            </li>
          ))}
        </ul>
        {onBudgetChange && budgetSpec && (
          <BudgetInput
            spec={budgetSpec}
            onChange={onBudgetChange}
            label={t("map.welcome.budget")}
            locale={locale}
          />
        )}
        <button type="button" ref={ctaRef} className="welcome__cta" onClick={onClose}>
          {t("map.welcome.cta")}
        </button>
        <p className="welcome__reopen">
          {t("map.welcome.reopen")}
        </p>
      </div>
    </div>
  );
}
