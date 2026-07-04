import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type CommuteVariation, type RegionInfo, getRegions } from "./api/client";
import ControlsPanel from "./components/ControlsPanel";
import MapView from "./components/MapView";
import Toasts from "./components/Toasts";
import WelcomeModal from "./components/WelcomeModal";
import ZipDetailPanel, { type ZipContext } from "./components/ZipDetailPanel";
import {
  DEFAULT_MINUTES,
  DEFAULT_MODE,
  DEFAULT_STATE,
  DEFAULT_WORK,
  METRICS,
  type MetricKey,
  SCENARIO_STYLES,
  type TravelMode,
  type WorkLocation,
} from "./config";
import { useCommute } from "./hooks/useCommute";
import { useGeolocate } from "./hooks/useGeolocate";
import { NOTICE_ISOCHRONE, useIsochrone } from "./hooks/useIsochrone";
import { useReverseGeocode } from "./hooks/useReverseGeocode";
import { useMapData } from "./hooks/useMapData";
import { useWikiSummary } from "./hooks/useWikiSummary";
import { metricValuesFromFeatures, resolveStops } from "./lib/colorScale";
import { departLabel, rangeLabel } from "./lib/format";
import { centroidsByZip, scenariosContaining } from "./lib/geo";
import { intersectIsochrones } from "./lib/intersect";
import { computeMatches } from "./lib/matches";
import { regionForPoint } from "./lib/locateRegion";
import { parseAppUrl, serializeAppUrl } from "./lib/urlState";
import { deltaPct, percentileRank, stateMedian } from "./lib/zipStats";

// Parsed once at startup (009 R5): seeds the initial state so a deep-linked
// region is the FIRST fetch, not a correction after a default load.
const INITIAL_URL = parseAppUrl(window.location.search);

// Geolocate only cold landings (010 R1): any recognized URL param marks an
// intentional, shareable link whose view must not be overridden.
const GEOLOCATE = Object.keys(INITIAL_URL).length === 0;

// Welcome-modal dismissal flag (017 R1). Already namespaced for 018.
const WELCOME_KEY = "livenear.welcome-dismissed";

function welcomeDismissed(): boolean {
  try {
    return window.localStorage.getItem(WELCOME_KEY) === "1";
  } catch {
    return true; // storage blocked -> never nag
  }
}

export default function App() {
  const [budget, setBudget] = useState(INITIAL_URL.budget ?? 0);
  const [metricKey, setMetricKey] = useState<MetricKey>(INITIAL_URL.metric ?? "value");
  const [minutes, setMinutes] = useState<number>(INITIAL_URL.minutes ?? DEFAULT_MINUTES);
  const [mode, setMode] = useState<TravelMode>(INITIAL_URL.tmode ?? DEFAULT_MODE);
  const [work, setWork] = useState<WorkLocation>(INITIAL_URL.work ?? DEFAULT_WORK);
  // Second workplace (016): null = single-pin mode.
  const [work2, setWork2] = useState<WorkLocation | null>(INITIAL_URL.work2 ?? null);
  // Which pin the address search moves (only relevant in dual mode).
  const [searchTarget, setSearchTarget] = useState<"A" | "B">("A");
  const [regions, setRegions] = useState<RegionInfo[]>([]);
  const [stateCode, setStateCode] = useState<string>(INITIAL_URL.state ?? DEFAULT_STATE);
  // Bumped on programmatic work moves (address / reset) so the map flies there.
  const [recenter, setRecenter] = useState(0);
  // Click-to-select (009 R1): drives the outline + detail panel.
  const [selectedZip, setSelectedZip] = useState<string | null>(null);
  // Pin-and-compare (009 R7).
  const [pinnedZip, setPinnedZip] = useState<string | null>(null);
  // Fly target for top movers / deep links (counter pattern, 009 R5/R6).
  const [focusPoint, setFocusPoint] = useState<[number, number] | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  // Deep-linked ZIP: applied once when its state's data has arrived.
  const pendingZipRef = useRef<string | null>(INITIAL_URL.zip ?? null);
  // Geolocated landing (010 R1): a fix arriving after the user has started
  // driving is discarded; applied at most once.
  const userTouchedRef = useRef(false);
  const geoAppliedRef = useRef(false);
  const geoFix = useGeolocate(GEOLOCATE);
  // First-visit welcome (017 R1); reopenable from About -> "How it works".
  const [showWelcome, setShowWelcome] = useState(() => !welcomeDismissed());
  const handleWelcomeClose = useCallback(() => {
    setShowWelcome(false);
    try {
      window.localStorage.setItem(WELCOME_KEY, "1");
    } catch {
      /* storage blocked -> dismiss for this session only */
    }
  }, []);

  const activeMetric = METRICS.find((m) => m.key === metricKey) ?? METRICS[0];
  const { geojson, records, loading, error, notices } = useMapData(stateCode);

  // Per-pin reach overlays (016 R2); server caches stay per-location.
  const iso1 = useIsochrone(work, minutes, mode);
  const iso2 = useIsochrone(work2, minutes, mode);
  const isoLoading = iso1.loading || iso2.loading;
  const dual = work2 != null;

  // Where BOTH can commute: matching scenario bands intersected client-side.
  const intersection = useMemo(
    () =>
      dual && iso1.isochrone && iso2.isochrone
        ? intersectIsochrones(iso1.isochrone, iso2.isochrone)
        : null,
    [dual, iso1.isochrone, iso2.isochrone],
  );
  // Dual mode shows the intersection ONLY (user direction, 016 fix): no
  // per-pin context rings — the empty-intersection message covers "if any".
  const isochrone = dual ? (intersection?.collection ?? null) : iso1.isochrone;

  const [regionsFailed, setRegionsFailed] = useState(false);
  useEffect(() => {
    getRegions()
      .then((r) => {
        setRegions(r);
        setRegionsFailed(false);
      })
      .catch(() => setRegionsFailed(true));
  }, []);

  const region = regions.find((r) => r.code === stateCode) ?? null;

  // Stable per-state ramp: equal-count buckets over the WHOLE state's
  // distribution (each color ≈ the same number of ZIPs), shared by the map
  // fill and the legend. Falls back to the geojson's own values while the
  // records fetch is still in flight.
  const stops = useMemo(() => {
    const values =
      records.size > 0
        ? [...records.values()].map(
            (r) => (r as unknown as Record<string, number | null>)[activeMetric.property] ?? null,
          )
        : metricValuesFromFeatures(
            (geojson?.features ?? []) as { properties?: Record<string, unknown> | null }[],
            activeMetric.property,
          );
    return resolveStops(activeMetric, values);
  }, [records, geojson, activeMetric]);

  // Single-pin: the backend's variation summary. Dual: client-computed
  // shared-reach areas (016 R5).
  const variation = dual
    ? (intersection?.variation ?? null)
    : ((iso1.isochrone as { properties?: { variation?: CommuteVariation } } | null)?.properties
        ?.variation ?? null);

  // One centroid per ZIP (009): commute-reach check now, fly-to targets later.
  const centroids = useMemo(() => centroidsByZip(geojson), [geojson]);

  // Affordable-AND-commutable shortlist (019 R1): null until a reach overlay
  // exists so the fold only appears once there is something to match against.
  const matches = useMemo(
    () => (isochrone ? computeMatches(records, centroids, isochrone, budget) : null),
    [records, centroids, isochrone, budget],
  );

  // Routed commute estimates for the selected ZIP (013; per-pin in 016).
  const selectedCentroid = selectedZip ? (centroids.get(selectedZip) ?? null) : null;
  const { estimate: commute, loading: commuteALoading } = useCommute(
    selectedCentroid,
    work,
    mode,
  );
  const { estimate: commuteB, loading: commuteBLoading } = useCommute(
    selectedCentroid,
    work2,
    mode,
  );
  const commuteLoading = commuteALoading || commuteBLoading;

  // Wikipedia summary of the selected place (012 R3) — best-effort.
  const wiki = useWikiSummary(
    selectedZip ? (records.get(selectedZip)?.name ?? null) : null,
    region?.name ?? null,
  );

  // Context block for the detail panel — pure computations over loaded data.
  const zipContext = useMemo<ZipContext>(() => {
    const empty: ZipContext = {
      percentile: null,
      vsStateMedianPct: null,
      commuteReach: null,
      driveToWork: null,
      driveHome: null,
      driveToWork2: null,
      driveHome2: null,
    };
    if (!selectedZip) return empty;
    const record = records.get(selectedZip);
    const values = [...records.values()].map((r) => r.median_value);
    const percentile = record ? percentileRank(values, record.median_value) : null;
    const vsStateMedianPct = record
      ? deltaPct(record.median_value, stateMedian(values))
      : null;

    let commuteReach: string | null = null;
    const centroid = centroids.get(selectedZip);
    if (centroid && isochrone) {
      const contained = new Set(scenariosContaining(centroid, isochrone));
      // SCENARIO_STYLES is ordered outer (widest) -> inner; the innermost band
      // containing the ZIP center is the strongest guarantee.
      const best = [...SCENARIO_STYLES].reverse().find((s) => contained.has(s.key));
      commuteReach = best
        ? `Within a ${minutes}-min drive of work in typical ${best.label.toLowerCase()} — bad days run longer`
        : `Beyond a ${minutes}-min drive of work in typical traffic`;
    }
    // Mode-aware estimate lines (013 R3; compact A/B form in dual, 016 R4).
    const verb = { drive: "Drive", walk: "Walk", cycle: "Cycle" }[mode];
    const window = (start: string | null, end: string | null) =>
      !dual && start && end
        ? ` (departing ${departLabel(start)}–${departLabel(end).replace(/^\w+ /, "")})`
        : "";
    const lines = (
      est: typeof commute,
      workLabel: string,
    ): [string | null, string | null] => {
      if (!est) return [null, null];
      return [
        `${verb} to ${workLabel}: ${rangeLabel(est.am_min_minutes, est.am_max_minutes)}${window(
          est.am_window_start_local,
          est.am_window_end_local,
        )}`,
        `${verb} home: ${rangeLabel(est.pm_min_minutes, est.pm_max_minutes)}${window(
          est.pm_window_start_local,
          est.pm_window_end_local,
        )}`,
      ];
    };
    const [driveToWork, driveHome] = lines(commute, dual ? "Work A" : "work");
    const [driveToWork2, driveHome2] = dual ? lines(commuteB, "Work B") : [null, null];
    return {
      percentile,
      vsStateMedianPct,
      commuteReach,
      driveToWork,
      driveHome,
      driveToWork2,
      driveHome2,
    };
  }, [selectedZip, records, centroids, isochrone, minutes, commute, commuteB, mode, dual]);

  // Esc closes the detail panel (009 R1).
  useEffect(() => {
    if (!selectedZip) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelectedZip(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedZip]);

  // Select + fly to a ZIP (top movers, deep links).
  const selectZipAndFly = useCallback(
    (zip: string) => {
      setSelectedZip(zip);
      const centroid = centroids.get(zip);
      if (centroid) {
        setFocusPoint(centroid);
        setFocusSignal((n) => n + 1);
      }
    },
    [centroids],
  );

  // Apply a geolocation fix once regions are loaded (010 R1): switch to the
  // visitor's state with the pin at their location, silently. The WA default
  // keeps rendering until (and unless) this fires.
  useEffect(() => {
    if (!geoFix || geoAppliedRef.current || userTouchedRef.current || regions.length === 0) {
      return;
    }
    geoAppliedRef.current = true;
    const r = regionForPoint(geoFix.lat, geoFix.lon, regions);
    if (!r) return; // outside every region (e.g. abroad) -> keep the default
    setStateCode(r.code);
    setWork({ lat: geoFix.lat, lon: geoFix.lon });
    // Same-state fixes don't change fitBbox, so fly to the pin explicitly;
    // cross-state fixes get the region fit (it runs after and wins).
    setRecenter((n) => n + 1);
  }, [geoFix, regions]);

  // Apply the deep-linked ZIP once its state's records + geometry are in
  // (009 R5). Unknown ZIPs are dropped silently.
  useEffect(() => {
    const zip = pendingZipRef.current;
    if (!zip || records.size === 0 || centroids.size === 0) return;
    pendingZipRef.current = null;
    if (records.has(zip)) selectZipAndFly(zip);
  }, [records, centroids, selectZipAndFly]);

  // Write app state back to the URL, debounced — pin drags fire frequently and
  // replaceState (not pushState) keeps the back button pointing out of the app.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const qs = serializeAppUrl({
        state: stateCode,
        zip: selectedZip,
        budget,
        work,
        work2,
        minutes,
        metric: metricKey,
        tmode: mode,
      });
      window.history.replaceState(null, "", `${window.location.pathname}${qs}`);
    }, 300);
    return () => window.clearTimeout(t);
  }, [stateCode, selectedZip, budget, work, work2, minutes, metricKey, mode]);

  // Seed labels for the pin-address lines (015 R1): an address search already
  // knows its place_name — show it instantly; drags clear it so the reverse
  // lookup takes over.
  const [workSeed, setWorkSeed] = useState<string | null>(null);
  const [work2Seed, setWork2Seed] = useState<string | null>(null);
  const handleWorkDrag = useCallback((lat: number, lon: number) => {
    userTouchedRef.current = true;
    setWork({ lat, lon });
    setWorkSeed(null);
  }, []);
  const handleWork2Drag = useCallback((lat: number, lon: number) => {
    userTouchedRef.current = true;
    setWork2({ lat, lon });
    setWork2Seed(null);
  }, []);
  const handleAddressLocated = useCallback(
    (lat: number, lon: number, label: string) => {
      userTouchedRef.current = true;
      if (searchTarget === "B" && work2 != null) {
        setWork2({ lat, lon });
        setWork2Seed(label);
      } else {
        setWork({ lat, lon });
        setWorkSeed(label);
      }
      setRecenter((n) => n + 1);
    },
    [searchTarget, work2],
  );

  // Second-pin lifecycle (016 R1): spawn near pin A, remove resets to single.
  const handleAddWork2 = useCallback(() => {
    userTouchedRef.current = true;
    setWork2({ lat: work.lat, lon: work.lon + 0.02 });
    setWork2Seed(null);
    setSearchTarget("B");
  }, [work]);
  const handleRemoveWork2 = useCallback(() => {
    setWork2(null);
    setWork2Seed(null);
    setSearchTarget("A");
  }, []);

  const workAddress = useReverseGeocode(work.lat, work.lon, workSeed);
  const work2Address = useReverseGeocode(work2?.lat ?? null, work2?.lon ?? null, work2Seed);

  const handleStateChange = useCallback(
    (code: string) => {
      userTouchedRef.current = true;
      setStateCode(code);
      setSelectedZip(null); // records are per-state; stale selections are meaningless
      setPinnedZip(null);
      setWork2(null); // a cross-state second pin is meaningless
      setSearchTarget("A");
      const r = regions.find((x) => x.code === code);
      if (r?.center) setWork({ lat: r.center[1], lon: r.center[0] });
    },
    [regions],
  );

  return (
    <div className="app">
      <h1 className="sr-only">LiveNear — housing affordability and commute map</h1>
      <MapView
        geojson={geojson}
        isochrone={isochrone}
        records={records}
        activeMetric={activeMetric}
        stops={stops}
        budget={budget}
        work={work}
        onWorkChange={handleWorkDrag}
        work2={work2}
        onWork2Change={handleWork2Drag}
        recenterSignal={recenter}
        fitBbox={region?.bbox ?? null}
        fitInitialBounds={INITIAL_URL.state != null && INITIAL_URL.zip == null}
        selectedZip={selectedZip}
        pinnedZip={pinnedZip}
        onSelectZip={(zip) => setSelectedZip((prev) => (prev === zip ? null : zip))}
        stateCode={stateCode}
        focusPoint={focusPoint}
        focusSignal={focusSignal}
      />
      {selectedZip && (
        <ZipDetailPanel
          zip={selectedZip}
          record={records.get(selectedZip)}
          metroLabel={region?.name ?? stateCode}
          stateCode={stateCode}
          budget={budget}
          context={zipContext}
          estimating={commuteLoading}
          wiki={wiki}
          onClose={() => setSelectedZip(null)}
          pinnedZip={pinnedZip}
          pinnedRecord={pinnedZip ? records.get(pinnedZip) : undefined}
          onPin={() => setPinnedZip(selectedZip)}
          onUnpin={() => setPinnedZip(null)}
        />
      )}
      <ControlsPanel
        regions={regions}
        state={stateCode}
        onStateChange={handleStateChange}
        budget={budget}
        onBudgetChange={setBudget}
        activeMetric={activeMetric}
        stops={stops}
        metricKey={metricKey}
        onMetricChange={setMetricKey}
        minutes={minutes}
        onMinutesChange={setMinutes}
        variation={variation}
        dual={dual}
        mode={mode}
        onModeChange={setMode}
        onAddressLocated={handleAddressLocated}
        workAddress={workAddress}
        work2Address={work2Address}
        hasWork2={dual}
        onAddWork2={handleAddWork2}
        onRemoveWork2={handleRemoveWork2}
        searchTarget={searchTarget}
        onSearchTargetChange={setSearchTarget}
        searchProximity={region?.center ? { lat: region.center[1], lon: region.center[0] } : null}
        matches={matches}
        records={records}
        onZipChosen={selectZipAndFly}
        onShowIntro={() => setShowWelcome(true)}
      />
      <button
        type="button"
        className="recenter"
        aria-label="Recenter on the work pin"
        title="Recenter on the work pin"
        onClick={() => setRecenter((n) => n + 1)}
      >
        ⌖
      </button>
      {isoLoading && (
        <div className="iso-chip" role="status">
          Updating reach…
        </div>
      )}
      {dual && intersection?.empty && !isoLoading && (
        <div className="status status--warn iso-empty" role="status">
          No area within both commutes — try a longer time or move a pin
        </div>
      )}
      {showWelcome && <WelcomeModal onClose={handleWelcomeClose} />}
      <Toasts
        messages={[
          ...notices,
          ...(iso1.failed || iso2.failed ? [NOTICE_ISOCHRONE] : []),
          ...(regionsFailed ? [`Region list unavailable — showing ${stateCode} only`] : []),
        ]}
      />
      {loading && (
        <div className="status" role="status">
          Loading map…
        </div>
      )}
      {error && (
        <div className="status status--error" role="alert">
          Couldn’t load map data: {error}
        </div>
      )}
    </div>
  );
}
