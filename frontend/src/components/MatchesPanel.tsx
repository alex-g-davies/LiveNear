import { useT } from "../i18n/react";
import type { MatchResult } from "../lib/matches";
import { type Locale, US_LOCALE } from "../lib/locale";

interface Props {
  /** Null while no isochrone is loaded (or the fetch failed) — hides the fold. */
  result: MatchResult | null;
  budget: number;
  onZipChosen: (zip: string) => void;
  locale?: Locale;
}

/** Ranked affordable-AND-commutable shortlist (019 R2/R3) — the panel that
 * states the answer the overlays only show. Follows the Top-movers fold and
 * row pattern. */
export default function MatchesPanel({ result, budget, onZipChosen, locale = US_LOCALE }: Props) {
  const { t } = useT();
  if (!result) return null;
  const us = locale.country === "US";
  const { matches, total } = result;

  return (
    <details className="matches panel-fold" open>
      <summary>
        {t("map.matches.title")}
        {total > 0 && <span className="matches__count"> ({total})</span>}
      </summary>
      {total === 0 ? (
        <p className="matches__empty">
          {budget > 0
            ? t(us ? "map.matches.noneBudget.us" : "map.matches.noneBudget.no")
            : t(us ? "map.matches.none.us" : "map.matches.none.no")}
        </p>
      ) : (
        <>
          <p className="matches__hint">
            {budget > 0 ? t("map.matches.hintBudget") : t("map.matches.hint")}
          </p>
          <ul className="matches__list">
            {matches.map((m) => (
              <li key={m.zip}>
                <button type="button" className="matches__row" onClick={() => onZipChosen(m.zip)}>
                  <span className="matches__place">{m.name ?? m.zip}</span>
                  <span className="matches__stats">
                    <span className="matches__value">{locale.moneyCompact(m.median_value)}</span>
                    {m.price_to_income != null && (
                      <span className="matches__p2i">{locale.decimal(m.price_to_income.toFixed(1))}×</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}
