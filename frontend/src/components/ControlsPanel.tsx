import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";

import type { CommuteVariation, RegionInfo, ZipValue } from "../api/client";
import { BRAND_NAME } from "../config";
import { useT } from "../i18n/react";
import type { ColorStop, MetricDef, MetricKey, TravelMode } from "../config";
import type { BudgetSpec } from "../lib/affordability";
import type { Locale } from "../lib/locale";
import type { MatchResult } from "../lib/matches";
import { LANDING_PATH } from "../lib/productRoutes";
import AboutPanel from "./AboutPanel";
import AddressSearch from "./AddressSearch";
import BudgetInput from "./BudgetInput";
import CommuteControl from "./CommuteControl";
import Legend from "./Legend";
import MatchesPanel from "./MatchesPanel";
import MetricSwitcher from "./MetricSwitcher";
import LanguagePicker from "./LanguagePicker";
import ProductSwitcher from "./ProductSwitcher";
import ReferenceSize from "./ReferenceSize";
import RegionPicker from "./RegionPicker";
import TopMovers from "./TopMovers";

interface Props {
  regions: RegionInfo[];
  state: string;
  onStateChange: (code: string) => void;
  /** Effective dollar budget (legend + downstream); derived from the spec. */
  budget: number;
  /** Budget as typed — price or monthly payment (020 R2). */
  budgetSpec: BudgetSpec;
  onBudgetSpecChange: (spec: BudgetSpec) => void;
  /** Vintage of the loaded values (`as_of`) for the legend + About. */
  asOf: string | null;
  activeMetric: MetricDef;
  stops: ColorStop[];
  metricKey: MetricKey;
  onMetricChange: (key: MetricKey) => void;
  minutes: number;
  onMinutesChange: (minutes: number) => void;
  variation: CommuteVariation | null;
  /** Dual-workplace mode (016): variation shows shared-reach areas. */
  dual: boolean;
  mode: TravelMode;
  onModeChange: (mode: TravelMode) => void;
  onAddressLocated: (lat: number, lon: number, label: string) => void;
  /** Reverse-geocoded nearest addresses per pin (015 R1); null hides a row. */
  workAddress: string | null;
  work2Address: string | null;
  hasWork2: boolean;
  onAddWork2: () => void;
  onRemoveWork2: () => void;
  searchTarget: "A" | "B";
  onSearchTargetChange: (target: "A" | "B") => void;
  /** Bias point for address search — the selected region's center. */
  searchProximity: { lat: number; lon: number } | null;
  /** Affordable-AND-commutable shortlist (019); null hides the fold. */
  matches: MatchResult | null;
  records: Map<string, ZipValue>;
  onZipChosen: (zip: string) => void;
  /** Reopens the welcome modal from the About panel (017 R1). */
  onShowIntro?: () => void;
  /** First-visit getting-started checklist (new-user onboarding); null hides it. */
  firstRun?: ReactNode;
  locale: Locale;
  metrics: MetricDef[];
  /** Shown only for regions priced per m² (026 R9). */
  referenceM2: number | null;
  onReferenceM2Change: (m2: number) => void;
}

/** Floating panel: title, region picker, budget, work controls, switcher, legend. */
export default function ControlsPanel({
  regions,
  state,
  onStateChange,
  budget,
  budgetSpec,
  onBudgetSpecChange,
  asOf,
  activeMetric,
  stops,
  metricKey,
  onMetricChange,
  minutes,
  onMinutesChange,
  variation,
  dual,
  mode,
  onModeChange,
  onAddressLocated,
  workAddress,
  work2Address,
  hasWork2,
  onAddWork2,
  onRemoveWork2,
  searchTarget,
  onSearchTargetChange,
  searchProximity,
  matches,
  records,
  onZipChosen,
  onShowIntro,
  firstRun,
  locale,
  metrics,
  referenceM2,
  onReferenceM2Change,
}: Props) {
  // Mobile-only collapse (015 R5); the toggle is display:none on desktop.
  const [collapsed, setCollapsed] = useState(false);
  const { t } = useT();
  const us = locale.country === "US";
  return (
    <div className={`panel${collapsed ? " panel--collapsed" : ""}`}>
      <button
        type="button"
        className="sheet-toggle"
        aria-expanded={!collapsed}
        aria-label={collapsed ? t("map.panel.expand") : t("map.panel.collapse")}
        onClick={() => setCollapsed((v) => !v)}
      >
        {collapsed ? "▲" : "▼"}
      </button>
      <div className="panel-head">
        <Link to={LANDING_PATH} aria-label={t("common.backHome", { name: BRAND_NAME })}>
          <img src="/brand/livenear-logo.svg" alt="" className="panel-logo" />
        </Link>
        <div className="panel-head__tools">
          <ProductSwitcher current="map" />
          <LanguagePicker />
        </div>
      </div>
      {firstRun}

      <div className="panel__section">
        {regions.length > 0 && (
          <RegionPicker regions={regions} state={state} onStateChange={onStateChange} />
        )}
        <BudgetInput
          spec={budgetSpec}
          onChange={onBudgetSpecChange}
          hint={t("map.panel.budgetHint")}
          locale={locale}
        />
        {referenceM2 != null && (
          <ReferenceSize value={referenceM2} onChange={onReferenceM2Change} />
        )}
      </div>

      <div className="panel__section work">
        <span className="work__label">{hasWork2 ? t("map.work.labelDual") : t("map.work.label")}</span>
        <AddressSearch
          onLocated={onAddressLocated}
          proximity={searchProximity}
          target={hasWork2 ? searchTarget : null}
          onTargetChange={onSearchTargetChange}
        />
        {workAddress && (
          <span className="work__address">
            {hasWork2 ? "🅰 " : "📍 "}
            {workAddress}
          </span>
        )}
        {hasWork2 && (
          <span className="work__address">
            {"🅱 "}
            {work2Address ?? t("map.work.dragB")}
            <button
              type="button"
              className="work__remove"
              aria-label={t("map.work.removeB")}
              onClick={onRemoveWork2}
            >
              ×
            </button>
          </span>
        )}
        {!hasWork2 && (
          <button type="button" className="work__add" onClick={onAddWork2}>
            {t("map.work.addB")}
          </button>
        )}
        <span className="work__hint">
          {hasWork2
            ? t("map.work.hintDual")
            : t("map.work.hint")}
        </span>
      </div>

      <div className="panel__section">
        <CommuteControl
          minutes={minutes}
          onMinutesChange={onMinutesChange}
          variation={variation}
          dual={dual}
          mode={mode}
          onModeChange={onModeChange}
          locale={locale}
        />
      </div>

      {matches && (
        <div className="panel__section">
          <MatchesPanel result={matches} budget={budget} onZipChosen={onZipChosen} locale={locale} />
        </div>
      )}

      <div className="panel__section">
        <span className="section-label">{t("map.metric.shadeBy")}</span>
        <MetricSwitcher active={metricKey} onChange={onMetricChange} metrics={metrics} />
        <Legend metric={activeMetric} stops={stops} budget={budget} asOf={asOf} />
        <TopMovers records={records} onZipChosen={onZipChosen} />
      </div>

      <p className="panel-foot">
        {us ? t("map.panel.footHoverUs") : t("map.panel.footHoverNo")} ·{" "}
        {t(`map.panel.footOverlay.${mode}`, { minutes })}
      </p>
      <AboutPanel onShowIntro={onShowIntro} asOf={asOf} />
    </div>
  );
}
