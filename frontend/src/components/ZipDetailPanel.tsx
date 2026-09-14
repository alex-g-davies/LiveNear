import { useEffect, useState } from "react";

import type { ZipValue } from "../api/client";
import { type BudgetSpec, monthlyPaymentForPrice } from "../lib/affordability";
import {
  formatCount,
  formatMonthly,
  formatPct,
  formatRatio,
  formatUsd,
  placeLabel,
} from "../lib/format";
import type { WikiSummary } from "../lib/wiki";
import { deltaPct } from "../lib/zipStats";
import PriceChart from "./PriceChart";

export interface ZipContext {
  /** Percent of the state's ZIPs at or below this ZIP's median value. */
  percentile: number | null;
  /** This ZIP's value vs the state median, signed percent. */
  vsStateMedianPct: number | null;
  /** Human-readable commute-reach line, or null when no isochrone is loaded. */
  commuteReach: string | null;
  /** Routed drive-time lines (011 R3); null while loading or unavailable. */
  driveToWork: string | null;
  driveHome: string | null;
  /** Second-workplace lines (016 R4); null in single-pin mode. */
  driveToWork2: string | null;
  driveHome2: string | null;
}

interface Props {
  zip: string;
  record: ZipValue | undefined;
  metroLabel: string;
  stateCode: string;
  budget: number;
  /** Budget as typed (020 R4): in payment mode the badge echoes this ZIP's
   * estimated monthly payment under the same assumptions. */
  budgetSpec?: BudgetSpec;
  context: ZipContext;
  /** True while the commute estimate fetch is in flight (013 R3). */
  estimating: boolean;
  /** Wikipedia summary of the place (012 R3); null hides the section. */
  wiki: WikiSummary | null;
  onClose: () => void;
  /** Compare (009 R7): pin the current ZIP, then click another to compare. */
  pinnedZip: string | null;
  pinnedRecord: ZipValue | undefined;
  onPin: () => void;
  onUnpin: () => void;
}

function budgetBadge(budget: number, value: number | undefined, spec?: BudgetSpec) {
  if (!budget || value == null) return null;
  const diff = budget - value;
  const cls = diff >= 0 ? "zip-detail__badge--under" : "zip-detail__badge--over";
  const text =
    diff >= 0
      ? `Under budget by ${formatUsd(diff)}`
      : `Over budget by ${formatUsd(-diff)}`;
  const monthly =
    spec?.mode === "payment"
      ? ` · ≈ ${formatMonthly(monthlyPaymentForPrice(value, spec.downPct, spec.ratePct))}`
      : "";
  return (
    <span className={`zip-detail__badge ${cls}`}>
      {text}
      {monthly}
    </span>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="zip-detail__metric">
      <span className="zip-detail__metric-label">{label}</span>
      <span className={`zip-detail__metric-value${tone ? ` ${tone}` : ""}`}>{value}</span>
    </div>
  );
}

interface CompareRowDef {
  label: string;
  get: (r: ZipValue | undefined) => number | null;
  fmt: (v: number) => string;
  /** "pct" -> relative % delta; "pp" -> percentage-point difference. */
  delta: "pct" | "pp";
}

const COMPARE_ROWS: CompareRowDef[] = [
  { label: "Median value", get: (r) => r?.median_value ?? null, fmt: formatUsd, delta: "pct" },
  { label: "YoY", get: (r) => r?.yoy_pct ?? null, fmt: formatPct, delta: "pp" },
  {
    label: "$/sqft sold",
    get: (r) => r?.ppsf ?? null,
    fmt: (v) => `$${Math.round(v)}`,
    delta: "pct",
  },
  { label: "HH income", get: (r) => r?.median_income ?? null, fmt: formatUsd, delta: "pct" },
  {
    label: "Price ÷ income",
    get: (r) => r?.price_to_income ?? null,
    fmt: (v) => formatRatio(v),
    delta: "pct",
  },
];

function deltaCell(def: CompareRowDef, pinned: number | null, selected: number | null) {
  if (pinned == null || selected == null) return "—";
  if (def.delta === "pp") return `${formatPct(Math.round((selected - pinned) * 10) / 10)} pt`;
  const d = deltaPct(selected, pinned);
  return d == null ? "—" : formatPct(d);
}

function CompareView({
  pinnedZip,
  pinnedRecord,
  selectedZip,
  selectedRecord,
}: {
  pinnedZip: string;
  pinnedRecord: ZipValue | undefined;
  selectedZip: string;
  selectedRecord: ZipValue | undefined;
}) {
  return (
    <div className="zip-detail__compare" role="table" aria-label="ZIP comparison">
      <div className="zip-detail__compare-row zip-detail__compare-head" role="row">
        <span role="columnheader" />
        <span role="columnheader" className="zip-detail__compare-place">
          📌 {placeLabel(pinnedZip, pinnedRecord?.name ?? null)}
        </span>
        <span role="columnheader" className="zip-detail__compare-place">
          {placeLabel(selectedZip, selectedRecord?.name ?? null)}
        </span>
        <span role="columnheader">Δ</span>
      </div>
      {COMPARE_ROWS.map((def) => {
        const a = def.get(pinnedRecord);
        const b = def.get(selectedRecord);
        return (
          <div className="zip-detail__compare-row" role="row" key={def.label}>
            <span className="zip-detail__compare-label" role="rowheader">
              {def.label}
            </span>
            <span role="cell">{a == null ? "—" : def.fmt(a)}</span>
            <span role="cell">{b == null ? "—" : def.fmt(b)}</span>
            <span role="cell" className="zip-detail__compare-delta">
              {deltaCell(def, a, b)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Deep-dive panel for the selected ZIP (009 R2). Every field degrades to "—"
 * so the panel works on data built without ACS (R9). With a different ZIP
 * pinned, it becomes a side-by-side comparison (R7). */
export default function ZipDetailPanel({
  zip,
  record,
  metroLabel,
  stateCode,
  budget,
  budgetSpec,
  context,
  estimating,
  wiki,
  onClose,
  pinnedZip,
  pinnedRecord,
  onPin,
  onUnpin,
}: Props) {
  const comparing = pinnedZip != null && pinnedZip !== zip;
  const yoy = record?.yoy_pct ?? null;
  const [wikiExpanded, setWikiExpanded] = useState(false);
  // Mobile-only collapse (015 R5); selecting a new ZIP re-expands.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setCollapsed(false), [zip]);

  return (
    <aside
      className={`zip-detail${collapsed ? " zip-detail--collapsed" : ""}`}
      aria-label={`Details for ZIP ${zip}`}
    >
      <button
        type="button"
        className="sheet-toggle"
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand details" : "Collapse details"}
        onClick={() => setCollapsed((v) => !v)}
      >
        {collapsed ? "▲" : "▼"}
      </button>
      <header className="zip-detail__head">
        <div>
          <h2 className="zip-detail__title">
            {comparing ? "Compare" : placeLabel(zip, record?.name ?? null, stateCode)}
          </h2>
          <p className="zip-detail__sub">{metroLabel}</p>
        </div>
        <button type="button" className="zip-detail__close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>

      {comparing ? (
        <>
          <CompareView
            pinnedZip={pinnedZip}
            pinnedRecord={pinnedRecord}
            selectedZip={zip}
            selectedRecord={record}
          />
          <button type="button" className="zip-detail__pin" onClick={onUnpin}>
            Unpin {pinnedZip}
          </button>
        </>
      ) : (
        <>
          <p className="zip-detail__value">
            {record ? formatUsd(record.median_value) : "No price data"}
          </p>
          {budgetBadge(budget, record?.median_value, budgetSpec)}

          <div className="zip-detail__metrics">
            <Metric
              label="YoY"
              value={yoy == null ? "—" : formatPct(yoy)}
              tone={yoy == null ? undefined : yoy >= 0 ? "tip__metric--up" : "tip__metric--down"}
            />
            <Metric
              label="5-yr CAGR"
              value={record?.cagr5_pct == null ? "—" : `${formatPct(record.cagr5_pct)}/yr`}
            />
            <Metric
              label="$/sqft sold"
              value={record?.ppsf == null ? "—" : `$${Math.round(record.ppsf)}`}
            />
          </div>

          <div className="zip-detail__metrics">
            <Metric label="Population" value={formatCount(record?.population)} />
            <Metric
              label="HH income"
              value={record?.median_income == null ? "—" : formatUsd(record.median_income)}
            />
            <Metric label="Price ÷ income" value={formatRatio(record?.price_to_income)} />
          </div>

          <PriceChart history={record?.history ?? null} />

          <div className="zip-detail__context">
            {estimating && !context.driveToWork && (
              <p className="zip-detail__estimating">Estimating commute…</p>
            )}
            {context.driveToWork && (
              <p className="zip-detail__drive">
                <strong>{context.driveToWork}</strong>
              </p>
            )}
            {context.driveHome && (
              <p className="zip-detail__drive">
                <strong>{context.driveHome}</strong>
              </p>
            )}
            {context.driveToWork2 && (
              <p className="zip-detail__drive">
                <strong>{context.driveToWork2}</strong>
              </p>
            )}
            {context.driveHome2 && (
              <p className="zip-detail__drive">
                <strong>{context.driveHome2}</strong>
              </p>
            )}
            {context.percentile != null && (
              <p>
                Pricier than <strong>{context.percentile}%</strong> of {metroLabel} ZIPs
                {context.vsStateMedianPct != null && (
                  <>
                    {" "}
                    · <strong>{formatPct(context.vsStateMedianPct)}</strong> vs state median
                  </>
                )}
              </p>
            )}
            {context.commuteReach && <p>{context.commuteReach}</p>}
          </div>

          {wiki && (
            <section className="zip-wiki" aria-label="About this area">
              {wiki.thumbnailUrl && (
                <img className="zip-wiki__thumb" src={wiki.thumbnailUrl} alt="" />
              )}
              <p className={`zip-wiki__extract${wikiExpanded ? " zip-wiki__extract--open" : ""}`}>
                {wiki.extract}
              </p>
              <div className="zip-wiki__foot">
                <button
                  type="button"
                  className="zip-wiki__more"
                  onClick={() => setWikiExpanded((v) => !v)}
                >
                  {wikiExpanded ? "Less" : "More"}
                </button>
                {/* CC BY-SA attribution is required (012 R4). */}
                <a
                  className="zip-wiki__attrib"
                  href={wiki.pageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  From Wikipedia (CC BY-SA)
                </a>
              </div>
            </section>
          )}

          {pinnedZip === zip ? (
            <button type="button" className="zip-detail__pin" onClick={onUnpin}>
              📌 Pinned — click another ZIP to compare · Unpin
            </button>
          ) : (
            <button type="button" className="zip-detail__pin" onClick={onPin}>
              Pin to compare
            </button>
          )}
        </>
      )}
    </aside>
  );
}
