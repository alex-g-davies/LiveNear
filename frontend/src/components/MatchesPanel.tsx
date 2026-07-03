import type { MatchResult } from "../lib/matches";
import { formatUsdCompact } from "../lib/format";

interface Props {
  /** Null while no isochrone is loaded (or the fetch failed) — hides the fold. */
  result: MatchResult | null;
  budget: number;
  onZipChosen: (zip: string) => void;
}

/** Ranked affordable-AND-commutable shortlist (019 R2/R3) — the panel that
 * states the answer the overlays only show. Follows the Top-movers fold and
 * row pattern. */
export default function MatchesPanel({ result, budget, onZipChosen }: Props) {
  if (!result) return null;
  const { matches, total } = result;

  return (
    <details className="matches panel-fold" open>
      <summary>
        Your matches{total > 0 && <span className="matches__count"> ({total})</span>}
      </summary>
      {total === 0 ? (
        <p className="matches__empty">
          {budget > 0
            ? "No ZIPs are within both budget and reach — try raising either"
            : "No ZIPs are within commute reach — try a longer time"}
        </p>
      ) : (
        <>
          <p className="matches__hint">
            {budget > 0 ? "Within budget and commute reach" : "Within commute reach"} · most
            affordable first
          </p>
          <ul className="matches__list">
            {matches.map((m) => (
              <li key={m.zip}>
                <button type="button" className="matches__row" onClick={() => onZipChosen(m.zip)}>
                  <span className="matches__place">{m.name ?? m.zip}</span>
                  <span className="matches__stats">
                    <span className="matches__value">{formatUsdCompact(m.median_value)}</span>
                    {m.price_to_income != null && (
                      <span className="matches__p2i">{m.price_to_income.toFixed(1)}×</span>
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
