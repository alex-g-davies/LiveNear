// Recommendations (spec 024 R12): the "Start here" card on Your situation and
// the "Recommended for you" strip on Compare. Both read the same hook; the
// rows come ranked from the whole catalogue with one reason tag each, and
// every row carries its Live/Estimate badge so a car ranked on placeholder
// prices is visibly flagged.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import EnglishText from "../../components/EnglishText";
import { t } from "../../i18n/core";
import { useT } from "../../i18n/react";
import type { RecommendRow } from "../api";
import { buildRecommendRequest, useRecommend } from "../hooks/useRecommend";
import { addPairs, capHint, isSelected, wouldExceedCap } from "../lib/market";
import { MODE_LABELS, estimateLabels, measureDef, measureInSentence } from "../lib/measures";
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
  return t("carsCompare.rec.ruledOut", { count: n });
}

// The backend tags rows with one of these English phrases (routers/cars.py
// REASON_*); a new tag shows as marked English prose (028 R7).
const REASON_KEYS = {
  "lowest expected cost": "carsCompare.reason.lowest",
  "narrowest uncertainty band": "carsCompare.reason.narrowest",
  "best fun score": "carsCompare.reason.fun",
  "lowest cash up front": "carsCompare.reason.cash",
} as const;

function ReasonText({ reason }: { reason: string }) {
  useT();
  const key = REASON_KEYS[reason as keyof typeof REASON_KEYS];
  return key ? <>{t(key)}</> : <EnglishText>{reason}</EnglishText>;
}

const ADD_KEYS = ["carsCompare.rec.addOne", "carsCompare.rec.addTwo", "carsCompare.rec.addThree"] as const;

export function StartHereCard() {
  const { t } = useT();
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
          {t("carsCompare.rec.startHere")}
        </h2>
        <p className="cars-hint">
          {t("carsCompare.rec.startHint", { measure: measureInSentence(def) })}
          {rec.loading && <span className="cars-hint__loading"> · {t("carsCompare.updating")}</span>}
        </p>
      </div>
      {!request && (
        <p className="cars-empty" data-testid="rec-state">
          {t("carsCompare.rec.fixInputs")}
        </p>
      )}
      {request && rec.error && !rec.data && (
        <div className="status status--error" role="alert">
          {t("carsCompare.rec.error")} <EnglishText>{rec.error}</EnglishText>
        </div>
      )}
      {request && !rec.data && !rec.error && rec.loading && (
        <p className="cars-empty" data-testid="rec-state">
          {t("carsCompare.rec.ranking")}
        </p>
      )}
      {rec.data && rows.length === 0 && (
        <p className="cars-empty" data-testid="rec-state">
          {t("carsCompare.rec.nothing")} {ruledOutHint(rec.data.ruled_out) ?? ""}
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
                        <ReasonText reason={reason} />
                      </span>
                    ))}
                    <Badge status={res.status} estimates={estimateLabels(res)} />
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
              {added ? t("carsCompare.rec.added") : t(ADD_KEYS[Math.min(rows.length, 3) - 1])}
            </button>
            {over && (
              <span className="cars-hint" role="status">
                {capHint()}
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
  const { t } = useT();
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
          {t("carsCompare.rec.stripTitle")}
        </h2>
        <span className="cars-hint">
          {t("carsCompare.rec.stripHint", { measure: measureInSentence(def) })}
          {rec.loading && <span className="cars-hint__loading"> · {t("carsCompare.updating")}</span>}
        </span>
      </div>
      {rows.length === 0 && rec.data && (
        <p className="cars-hint">
          {t("carsCompare.rec.nothing")} {ruledOutHint(rec.data.ruled_out) ?? ""}
        </p>
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
                    <ReasonText reason={reason} />
                  </span>
                ))}
                <Badge status={res.status} estimates={estimateLabels(res)} />
                {inSel ? (
                  <span className="cars-strip__in">{t("carsCompare.rec.inComparison")}</span>
                ) : (
                  <button
                    type="button"
                    className="cars-btn cars-btn--outline cars-btn--sm"
                    aria-label={t("carsCompare.rec.addAria", { name: `${rowName(r)} ${res.model_year}` })}
                    disabled={over}
                    title={over ? capHint() : undefined}
                    onClick={() => setSelection(addPairs(selection, [[vid, res.model_year]]))}
                  >
                    {t("carsCompare.rec.add")}
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
          ? `${capHint()} `
          : ""}
        {t("carsCompare.rec.stripFoot")} <Link to={DRIVE_PATH}>{t("carsCompare.rec.changeSituation")}</Link>.
      </p>
    </section>
  );
}
