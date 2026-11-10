// Recommendations (spec 024 R12): the "Start here" card on Your situation and
// the "Recommended for you" strip on Compare. Both read the same hook; the
// rows come ranked from the whole catalogue with one reason tag each, and
// every row carries its Live/Estimate badge so a car ranked on placeholder
// prices is visibly flagged.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import type { RecommendRow } from "../api";
import { buildRecommendRequest, useRecommend } from "../hooks/useRecommend";
import { CAP_HINT, addPairs, isSelected, wouldExceedCap } from "../lib/market";
import { MODE_LABELS, measureDef } from "../lib/measures";
import { useCarState } from "../state";
import Badge from "./Badge";
import { DRIVE_PATH } from "../../lib/productRoutes";

const START_HERE_ROWS = 3;

function rowName(r: RecommendRow): string {
  const res = r.summary.result;
  return `${res.make} ${res.model} ${res.trim_group}`;
}

function ruledOutHint(ruled: Record<string, number>): string | null {
  const n = Object.values(ruled).reduce((a, b) => a + b, 0);
  if (!n) return null;
  return `${n} option${n === 1 ? "" : "s"} ruled out by your limits.`;
}

export function StartHereCard() {
  const { state, setSelection } = useCarState();
  const { profile, selection, measure } = state;
  const def = measureDef(measure);
  const request = useMemo(() => buildRecommendRequest(profile, measure), [profile, measure]);
  const rec = useRecommend(request);
  const [addedKey, setAddedKey] = useState<string | null>(null);

  const rows = (rec.data?.rows ?? []).slice(0, START_HERE_ROWS);
  const pairs = rows.map<[string, number]>((r) => [r.summary.variant_id, r.summary.result.model_year]);
  const allIn = pairs.length > 0 && pairs.every(([vid, y]) => isSelected(selection, vid, y));
  const rowsKey = rows.map((r) => r.summary.result.option_id).join("|");
  const added = addedKey === rowsKey && allIn;
  const over = !allIn && wouldExceedCap(selection, pairs.map(([vid]) => vid));

  const onAdd = () => {
    setSelection(addPairs(selection, pairs));
    setAddedKey(rowsKey);
  };

  return (
    <section className="cars-card cars-card--wide cars-rec" aria-labelledby="start-here">
      <div className="cars-card__head">
        <h2 id="start-here" className="cars-h2">
          Start here
        </h2>
        <p className="cars-hint">
          Ranked from every car in the catalogue for your situation, by {def.label.toLowerCase()}.
          {rec.loading && <span className="cars-hint__loading"> · updating…</span>}
        </p>
      </div>
      {!request && (
        <p className="cars-empty" data-testid="rec-state">
          Fix the exit odds and charging shares above to see recommendations.
        </p>
      )}
      {request && rec.error && !rec.data && (
        <div className="status status--error" role="alert">
          Could not rank the catalogue: {rec.error}
        </div>
      )}
      {request && !rec.data && !rec.error && rec.loading && (
        <p className="cars-empty" data-testid="rec-state">
          Ranking the catalogue…
        </p>
      )}
      {rec.data && rows.length === 0 && (
        <p className="cars-empty" data-testid="rec-state">
          Nothing passed your limits. {ruledOutHint(rec.data.ruled_out) ?? ""}
        </p>
      )}
      {rows.length > 0 && (
        <>
          <ol className="cars-rec__list">
            {rows.map((r) => {
              const res = r.summary.result;
              return (
                <li key={res.option_id} className="cars-rec__row" data-testid="rec-row">
                  <span className="cars-rec__rank" aria-hidden="true">
                    {r.rank}
                  </span>
                  <span className="cars-rec__main">
                    <span className="cars-rec__name">
                      {rowName(r)} {res.model_year}
                    </span>
                    <span className="cars-rec__mode">{MODE_LABELS[res.mode]}</span>
                  </span>
                  <span className="cars-rec__value" data-testid="rec-value">
                    {def.format(res.measures[measure].expected.p50)}
                    <small> {def.unit}</small>
                  </span>
                  <span className="cars-rec__tags">
                    {r.reasons.map((reason) => (
                      <span key={reason} className="cars-rec__tag">
                        {reason}
                      </span>
                    ))}
                    <Badge status={res.status} estimates={res.material_estimate_labels} />
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="cars-rec__foot">
            <button
              type="button"
              className={`cars-btn ${added ? "" : "cars-btn--primary"}`}
              disabled={added || over}
              onClick={onAdd}
            >
              {added ? "Added to your selection" : `Add these ${rows.length === 1 ? "one" : rows.length === 2 ? "two" : "three"} to my selection`}
            </button>
            {over && (
              <span className="cars-hint" role="status">
                {CAP_HINT}
              </span>
            )}
            {rec.data && ruledOutHint(rec.data.ruled_out) && (
              <span className="cars-hint">{ruledOutHint(rec.data.ruled_out)}</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export function RecommendStrip() {
  const { state, setSelection } = useCarState();
  const { profile, selection, measure } = state;
  const def = measureDef(measure);
  const request = useMemo(() => buildRecommendRequest(profile, measure), [profile, measure]);
  const rec = useRecommend(request);
  const rows = rec.data?.rows ?? [];
  if (!request || (!rec.data && !rec.loading)) return null;

  return (
    <section className="cars-strip" aria-labelledby="rec-strip">
      <div className="cars-strip__head">
        <h2 id="rec-strip" className="cars-strip__title">
          Recommended for you
        </h2>
        <span className="cars-hint">
          Whole catalogue, by {def.label.toLowerCase()}
          {rec.loading && <span className="cars-hint__loading"> · updating…</span>}
        </span>
      </div>
      {rows.length === 0 && rec.data && (
        <p className="cars-hint">Nothing passed your limits. {ruledOutHint(rec.data.ruled_out) ?? ""}</p>
      )}
      {rows.length > 0 && (
        <ol className="cars-strip__list">
          {rows.map((r) => {
            const res = r.summary.result;
            const vid = r.summary.variant_id;
            const inSel = isSelected(selection, vid, res.model_year);
            const over = !inSel && wouldExceedCap(selection, [vid]);
            return (
              <li key={res.option_id} className="cars-strip__row" data-testid="strip-row">
                <span className="cars-strip__rank" aria-hidden="true">
                  {r.rank}
                </span>
                <span className="cars-strip__name">
                  {rowName(r)} {res.model_year} · {MODE_LABELS[res.mode]}
                </span>
                <span className="cars-strip__value">{def.format(res.measures[measure].expected.p50)}</span>
                {r.reasons.map((reason) => (
                  <span key={reason} className="cars-rec__tag">
                    {reason}
                  </span>
                ))}
                <Badge status={res.status} estimates={res.material_estimate_labels} />
                {inSel ? (
                  <span className="cars-strip__in">In your comparison</span>
                ) : (
                  <button
                    type="button"
                    className="cars-btn cars-btn--outline cars-btn--sm"
                    aria-label={`Add ${rowName(r)} ${res.model_year}`}
                    disabled={over}
                    title={over ? CAP_HINT : undefined}
                    onClick={() => setSelection(addPairs(selection, [[vid, res.model_year]]))}
                  >
                    Add
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <p className="cars-hint cars-strip__foot">
        {rows.some((r) => !isSelected(selection, r.summary.variant_id, r.summary.result.model_year)) &&
        wouldExceedCap(selection, [])
          ? `${CAP_HINT} `
          : ""}
        Added cars appear in the table once the scenario re-runs. <Link to={DRIVE_PATH}>Change your situation</Link>.
      </p>
    </section>
  );
}
