import { useEffect, useState } from "react";

import type { ZipValue } from "../api/client";
import { t } from "../i18n/core";
import { useT } from "../i18n/react";
import { type BudgetSpec, monthlyPaymentForPrice } from "../lib/affordability";
import { formatPct, formatRatio } from "../lib/format";
import { type Locale, US_LOCALE } from "../lib/locale";
import { rich } from "../lib/rich";
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
  locale?: Locale;
  /** Size behind an estimated price (026 R9); null where prices aren't estimated. */
  referenceM2?: number | null;
  /** Name for an area with no record (026 R3). */
  fallbackName?: string | null;
}

function budgetBadge(
  budget: number,
  value: number | undefined,
  spec: BudgetSpec | undefined,
  locale: Locale,
) {
  if (!budget || value == null) return null;
  const diff = budget - value;
  const cls = diff >= 0 ? "zip-detail__badge--under" : "zip-detail__badge--over";
  const text =
    diff >= 0
      ? t("map.detail.underBudget", { amount: locale.money(diff) })
      : t("map.detail.overBudget", { amount: locale.money(-diff) });
  const monthly =
    spec?.mode === "payment"
      ? ` · ≈ ${locale.monthly(monthlyPaymentForPrice(value, spec.downPct, spec.ratePct, spec.taxPct))}`
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

function compareRows(locale: Locale): CompareRowDef[] {
  const norway = locale.country === "NO";
  const income: CompareRowDef = {
    label: norway ? t("map.detail.incomeAfterTax") : t("map.detail.hhIncome"),
    get: (r) => r?.median_income ?? null,
    fmt: locale.money,
    delta: "pct",
  };
  const ratio: CompareRowDef = {
    label: t("map.detail.priceToIncome"),
    get: (r) => r?.price_to_income ?? null,
    fmt: (v) => locale.decimal(formatRatio(v)),
    delta: "pct",
  };
  if (norway) {
    return [
      { label: t("map.detail.estPrice"), get: (r) => r?.median_value ?? null, fmt: locale.money, delta: "pct" },
      { label: "kr/m²", get: (r) => r?.price_per_m2 ?? null, fmt: locale.perArea, delta: "pct" },
      income,
      ratio,
    ];
  }
  return [
    { label: t("map.metric.value.label"), get: (r) => r?.median_value ?? null, fmt: locale.money, delta: "pct" },
    { label: t("map.detail.yoy"), get: (r) => r?.yoy_pct ?? null, fmt: formatPct, delta: "pp" },
    {
      label: t("map.detail.ppsfSold"),
      get: (r) => r?.ppsf ?? null,
      fmt: (v) => `$${Math.round(v)}`,
      delta: "pct",
    },
    income,
    ratio,
  ];
}

function deltaCell(def: CompareRowDef, pinned: number | null, selected: number | null) {
  if (pinned == null || selected == null) return "—";
  if (def.delta === "pp") {
    return t("map.detail.points", { value: formatPct(Math.round((selected - pinned) * 10) / 10) });
  }
  const d = deltaPct(selected, pinned);
  return d == null ? "—" : formatPct(d);
}

// Percentages in a Norwegian region use a decimal comma (028 R10).
function pct(value: number, locale: Locale): string {
  return locale.decimal(formatPct(value));
}

function CompareView({
  pinnedZip,
  pinnedRecord,
  selectedZip,
  selectedRecord,
  locale,
}: {
  pinnedZip: string;
  pinnedRecord: ZipValue | undefined;
  selectedZip: string;
  selectedRecord: ZipValue | undefined;
  locale: Locale;
}) {
  const { t } = useT();
  return (
    <div
      className="zip-detail__compare"
      role="table"
      aria-label={t(locale.country === "US" ? "map.detail.compareTable.us" : "map.detail.compareTable.no")}
    >
      <div className="zip-detail__compare-row zip-detail__compare-head" role="row">
        <span role="columnheader" />
        <span role="columnheader" className="zip-detail__compare-place">
          📌 {locale.place(pinnedZip, pinnedRecord?.name ?? null)}
        </span>
        <span role="columnheader" className="zip-detail__compare-place">
          {locale.place(selectedZip, selectedRecord?.name ?? null)}
        </span>
        <span role="columnheader">Δ</span>
      </div>
      {compareRows(locale).map((def) => {
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
              {locale.decimal(deltaCell(def, a, b))}
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
  locale = US_LOCALE,
  referenceM2 = null,
  fallbackName = null,
}: Props) {
  const { t, lang } = useT();
  const norway = locale.country === "NO";
  const comparing = pinnedZip != null && pinnedZip !== zip;
  const yoy = record?.yoy_pct ?? null;
  const [wikiExpanded, setWikiExpanded] = useState(false);
  // Mobile-only collapse (015 R5); selecting a new ZIP re-expands.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setCollapsed(false), [zip]);

  return (
    <aside
      className={`zip-detail${collapsed ? " zip-detail--collapsed" : ""}`}
      aria-label={
        norway
          ? t("map.detail.label", { name: record?.name ?? fallbackName ?? zip })
          : t("map.detail.labelZip", { zip })
      }
    >
      <button
        type="button"
        className="sheet-toggle"
        aria-expanded={!collapsed}
        aria-label={collapsed ? t("map.detail.expand") : t("map.detail.collapse")}
        onClick={() => setCollapsed((v) => !v)}
      >
        {collapsed ? "▲" : "▼"}
      </button>
      <header className="zip-detail__head">
        <div>
          <h2 className="zip-detail__title">
            {comparing ? t("map.detail.compare") : locale.place(zip, record?.name ?? fallbackName, stateCode)}
          </h2>
          <p className="zip-detail__sub">{metroLabel}</p>
        </div>
        <button type="button" className="zip-detail__close" aria-label={t("map.close")} onClick={onClose}>
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
            locale={locale}
          />
          <button type="button" className="zip-detail__pin" onClick={onUnpin}>
            {t("map.detail.unpin", { zip: pinnedZip })}
          </button>
        </>
      ) : (
        <>
          <p className="zip-detail__value">
            {record ? `${norway ? "≈ " : ""}${locale.money(record.median_value)}` : t("map.noPriceData")}
          </p>
          {norway && (
            <p className="zip-detail__sub">
              {record
                ? t("map.detail.estimateFor", { m2: referenceM2 ?? "—" })
                : t("map.detail.fewSales", { min: 10, year: 2025 })}
            </p>
          )}
          {budgetBadge(budget, record?.median_value, budgetSpec, locale)}

          {norway ? (
            record && (
              <div className="zip-detail__metrics zip-detail__metrics--pairs">
                <Metric
                  label={t("map.detail.avgPerM2")}
                  value={record.price_per_m2 == null ? "—" : locale.perArea(record.price_per_m2)}
                />
                <Metric label={t("map.detail.sales", { year: 2025 })} value={locale.count(record.sales)} />
                <Metric
                  label={record.income_level === "bydel" ? t("map.detail.incomeBydel") : t("map.detail.incomeAfterTax")}
                  value={record.median_income == null ? "—" : locale.money(record.median_income)}
                />
                {record.price_to_income != null && (
                  <Metric
                    label={t("map.detail.priceToIncome")}
                    value={locale.decimal(formatRatio(record.price_to_income))}
                  />
                )}
              </div>
            )
          ) : (
          <>
          <div className="zip-detail__metrics">
            <Metric
              label={t("map.detail.yoy")}
              value={yoy == null ? "—" : pct(yoy, locale)}
              tone={yoy == null ? undefined : yoy >= 0 ? "tip__metric--up" : "tip__metric--down"}
            />
            <Metric
              label={t("map.detail.cagr", { years: 5 })}
              value={
                record?.cagr5_pct == null
                  ? "—"
                  : t("map.unit.perYear", { value: pct(record.cagr5_pct, locale) })
              }
            />
            <Metric
              label={t("map.detail.ppsfSold")}
              value={record?.ppsf == null ? "—" : `$${Math.round(record.ppsf)}`}
            />
          </div>

          <div className="zip-detail__metrics">
            <Metric label={t("map.detail.population")} value={locale.count(record?.population)} />
            <Metric
              label={t("map.detail.hhIncome")}
              value={record?.median_income == null ? "—" : locale.money(record.median_income)}
            />
            <Metric
              label={t("map.detail.priceToIncome")}
              value={locale.decimal(formatRatio(record?.price_to_income))}
            />
          </div>

          <PriceChart history={record?.history ?? null} />
          </>
          )}

          <div className="zip-detail__context">
            {estimating && !context.driveToWork && (
              <p className="zip-detail__estimating">{t("map.detail.estimating")}</p>
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
                {rich(t(norway ? "map.detail.pricier.no" : "map.detail.pricier.us", { metro: metroLabel }), {
                  pct: <strong>{context.percentile}%</strong>,
                })}
                {context.vsStateMedianPct != null && (
                  <>
                    {" "}
                    ·{" "}
                    {rich(t(norway ? "map.detail.vsMedian.no" : "map.detail.vsMedian.us"), {
                      pct: <strong>{pct(context.vsStateMedianPct, locale)}</strong>,
                    })}
                  </>
                )}
              </p>
            )}
            {context.commuteReach && <p>{context.commuteReach}</p>}
          </div>

          {wiki && (
            <section className="zip-wiki" aria-label={t("map.detail.wikiLabel")}>
              {wiki.thumbnailUrl && (
                <img className="zip-wiki__thumb" src={wiki.thumbnailUrl} alt="" />
              )}
              {/* English Wikipedia text (R7): marked so readers know it is English. */}
              <p
                className={`zip-wiki__extract${wikiExpanded ? " zip-wiki__extract--open" : ""}`}
                lang={lang === "en" ? undefined : "en"}
              >
                {wiki.extract}
              </p>
              <div className="zip-wiki__foot">
                <button
                  type="button"
                  className="zip-wiki__more"
                  onClick={() => setWikiExpanded((v) => !v)}
                >
                  {wikiExpanded ? t("map.detail.less") : t("map.detail.more")}
                </button>
                {/* CC BY-SA attribution is required (012 R4). */}
                <a
                  className="zip-wiki__attrib"
                  href={wiki.pageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("map.detail.wikiCredit")}
                </a>
              </div>
            </section>
          )}

          {pinnedZip === zip ? (
            <button type="button" className="zip-detail__pin" onClick={onUnpin}>
              {t(norway ? "map.detail.pinned.no" : "map.detail.pinned.us")}
            </button>
          ) : (
            <button type="button" className="zip-detail__pin" onClick={onPin}>
              {t("map.detail.pin")}
            </button>
          )}
        </>
      )}
    </aside>
  );
}
