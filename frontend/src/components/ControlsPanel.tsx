import { type ReactNode, useState } from "react";

import type { CommuteVariation, RegionInfo, ZipValue } from "../api/client";
import { BRAND_NAME } from "../config";
import type { ColorStop, MetricDef, MetricKey, TravelMode } from "../config";
import type { MatchResult } from "../lib/matches";
import AboutPanel from "./AboutPanel";
import AddressSearch from "./AddressSearch";
import BudgetInput from "./BudgetInput";
import CommuteControl from "./CommuteControl";
import Legend from "./Legend";
import MatchesPanel from "./MatchesPanel";
import MetricSwitcher from "./MetricSwitcher";
import RegionPicker from "./RegionPicker";
import TopMovers from "./TopMovers";

interface Props {
  regions: RegionInfo[];
  state: string;
  onStateChange: (code: string) => void;
  budget: number;
  onBudgetChange: (budget: number) => void;
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
}

/** Floating panel: title, region picker, budget, work controls, switcher, legend. */
export default function ControlsPanel({
  regions,
  state,
  onStateChange,
  budget,
  onBudgetChange,
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
}: Props) {
  // Mobile-only collapse (015 R5); the toggle is display:none on desktop.
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className={`panel${collapsed ? " panel--collapsed" : ""}`}>
      <button
        type="button"
        className="sheet-toggle"
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand controls" : "Collapse controls"}
        onClick={() => setCollapsed((v) => !v)}
      >
        {collapsed ? "▲" : "▼"}
      </button>
      <img src="/brand/logo.png" alt={BRAND_NAME} className="panel-logo" />
      {firstRun}

      <div className="panel__section">
        {regions.length > 0 && (
          <RegionPicker regions={regions} state={state} onStateChange={onStateChange} />
        )}
        <BudgetInput
          budget={budget}
          onChange={onBudgetChange}
          hint="Set one to fade areas over budget and focus your matches"
        />
      </div>

      <div className="panel__section work">
        <span className="work__label">{hasWork2 ? "Work locations" : "Work location"}</span>
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
            {work2Address ?? "Drag pin B into place"}
            <button
              type="button"
              className="work__remove"
              aria-label="Remove second workplace"
              onClick={onRemoveWork2}
            >
              ×
            </button>
          </span>
        )}
        {!hasWork2 && (
          <button type="button" className="work__add" onClick={onAddWork2}>
            + Add second workplace
          </button>
        )}
        <span className="work__hint">
          {hasWork2
            ? "Drag a pin to move it — the map shows where BOTH can commute"
            : "Drag the pin to move it, or search an address"}
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
        />
      </div>

      {matches && (
        <div className="panel__section">
          <MatchesPanel result={matches} budget={budget} onZipChosen={onZipChosen} />
        </div>
      )}

      <div className="panel__section">
        <span className="section-label">Shade map by</span>
        <MetricSwitcher active={metricKey} onChange={onMetricChange} />
        <Legend metric={activeMetric} stops={stops} budget={budget} />
        <TopMovers records={records} onZipChosen={onZipChosen} />
      </div>

      <p className="panel-foot">
        Hover a ZIP for quick stats, click or tap for details · {minutes}-min drive-time overlay
      </p>
      <AboutPanel onShowIntro={onShowIntro} />
    </div>
  );
}
