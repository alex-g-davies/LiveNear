import { useEffect, useRef } from "react";

import { BRAND_NAME } from "../config";
import BudgetInput from "./BudgetInput";

const HOW_TOS: { icon: string; text: string }[] = [
  { icon: "💰", text: "Set a budget — areas you can't afford fade out." },
  {
    icon: "📍",
    text: "Drag the pin to work and pick a commute — the bands show how far you can live.",
  },
  { icon: "👆", text: "Click or tap any area for prices, commute estimates, and local context." },
];

interface Props {
  onClose: () => void;
  /** Optional budget capture (new-user onboarding): when wired, a first-timer
   * can set the budget here and land on an already-personalized map instead
   * of having to re-find the field in the panel. */
  budget?: number;
  onBudgetChange?: (budget: number) => void;
}

/** First-visit welcome modal (017 R1): what the site is and the three moves
 * that matter. App owns visibility + the localStorage dismissal flag; the
 * About panel's "How it works" link reopens it. */
export default function WelcomeModal({ onClose, budget, onBudgetChange }: Props) {
  // Keyboard users land inside the dialog instead of on the map behind it.
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
      aria-label={`Welcome to ${BRAND_NAME}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="about__card welcome__card">
        <header className="about__head">
          {/* The slogan banner, not the plain wordmark — this is the one
              landing surface where the tagline earns its space (018 R2). */}
          <img src="/brand/banner.png" alt={BRAND_NAME} className="welcome__logo" />
          <button type="button" className="about__close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <p className="about__blurb">
          See where you could live. {BRAND_NAME} shades every ZIP by housing cost
          and overlays how far you can really get from work at rush hour — so
          affordable <em>and</em> commutable shows up at a glance.
        </p>
        <ul className="welcome__steps">
          {HOW_TOS.map((h) => (
            <li key={h.icon}>
              <span className="welcome__icon" aria-hidden="true">
                {h.icon}
              </span>
              {h.text}
            </li>
          ))}
        </ul>
        {onBudgetChange && (
          <BudgetInput
            budget={budget ?? 0}
            onChange={onBudgetChange}
            label="Your max home price (optional)"
          />
        )}
        <button type="button" ref={ctaRef} className="welcome__cta" onClick={onClose}>
          Explore the map
        </button>
        <p className="welcome__reopen">
          Reopen this intro anytime via ⓘ About &amp; data → “How it works”.
        </p>
      </div>
    </div>
  );
}
