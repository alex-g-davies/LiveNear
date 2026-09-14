import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import type { FeatureCollection } from "geojson";

import {
  BASEMAP_STYLE_URL,
  IN_BUDGET_OPACITY,
  MAP_CENTER,
  MAP_ZOOM,
  type MetricDef,
  OVER_BUDGET_OPACITY,
  SCENARIO_STYLES,
  type ColorStop,
  type WorkLocation,
} from "../config";
import type { ZipValue } from "../api/client";
import { fillColorExpression, fillOpacityExpression, overBudgetFilter } from "../lib/colorScale";
import { buildZipPopupHtml } from "../lib/popup";

interface Props {
  geojson: FeatureCollection | null;
  isochrone: FeatureCollection | null;
  records: Map<string, ZipValue>;
  activeMetric: MetricDef;
  /** Resolved per-state ramp breaks, shared with the legend (stable — no
   * viewport re-spreading). */
  stops: ColorStop[];
  budget: number;
  work: WorkLocation;
  onWorkChange: (lat: number, lon: number) => void;
  /** Second workplace (016 R1); null = single-pin mode. */
  work2: WorkLocation | null;
  onWork2Change: (lat: number, lon: number) => void;
  /** Increment to fly the map to the current work location (address / reset). */
  recenterSignal: number;
  /** Region bounds to fit when the selected state changes (national). */
  fitBbox: [number, number, number, number] | null;
  /** Whether the FIRST fitBbox should fly (URL deep link to a state). Without
   * it the opening metro view is preserved, as before. */
  fitInitialBounds: boolean;
  /** ZIP selection (009 R1): clicking a ZIP selects it; outlines track these. */
  selectedZip: string | null;
  pinnedZip: string | null;
  onSelectZip: (zip: string) => void;
  /** Selected region code — shown in popup place labels (012 R2). */
  stateCode: string;
  /** Fly target for top movers / URL deep links (009 R5/R6): bump the signal
   * to fly to the point — same counter pattern as recenterSignal. */
  focusPoint: [number, number] | null;
  focusSignal: number;
  /** First visit (new-user onboarding): open the work pin's popup with a
   * "drag me" nudge so the pin is discoverable. Read once at map creation. */
  pinHint?: boolean;
}

const ZIP_SOURCE = "zips";
const ISO_SOURCE = "isochrone";
const ZIP_FILL = "zip-fill";
const ISO_LINE = "iso-line";
const ZIP_SELECTED = "zip-selected";
const ZIP_PINNED = "zip-pinned";
const ZIP_OVERBUDGET = "zip-overbudget";
const HATCH_IMAGE = "overbudget-hatch";

/** 45° hatch tile for over-budget ZIPs (017 R3) — canvas-generated, no
 * asset. Drawn at 2x and registered with pixelRatio 2 so it stays crisp on
 * retina. Three parallel strokes tile seamlessly across the square. */
function hatchImage(): ImageData | null {
  const size = 16; // 8 CSS px per tile at pixelRatio 2
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.strokeStyle = "rgba(90, 100, 115, 0.9)";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(0, size);
  ctx.lineTo(size, 0);
  ctx.moveTo(-size / 2, size / 2);
  ctx.lineTo(size / 2, -size / 2);
  ctx.moveTo(size / 2, size * 1.5);
  ctx.lineTo(size * 1.5, size / 2);
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

/** Brand-badge pin element with an A/B label (016 R1). */
function makePinElement(label: string): { el: HTMLDivElement; badge: HTMLSpanElement } {
  const el = document.createElement("div");
  el.className = "work-pin-wrap";
  const img = document.createElement("img");
  img.src = "/brand/mark-512.png";
  img.alt = `Work location ${label}`;
  img.className = "work-pin";
  const badge = document.createElement("span");
  badge.className = "work-pin__badge";
  badge.textContent = label;
  el.append(img, badge);
  return { el, badge };
}

/** Filter matching exactly one ZIP (or nothing, for null). */
function zipFilter(zip: string | null): maplibregl.FilterSpecification {
  return ["==", ["get", "zip"], zip ?? ""] as unknown as maplibregl.FilterSpecification;
}

/** Id of the basemap's first label (symbol) layer. Custom layers are inserted
 * before it so basemap labels (city/road names) render on top of the choropleth. */
function firstSymbolLayerId(m: maplibregl.Map): string | undefined {
  for (const layer of m.getStyle().layers ?? []) {
    if (layer.type === "symbol") return layer.id;
  }
  return undefined;
}

/** Id of the basemap's (opaque) water fill layer. Inserting the choropleth
 * before it lets the basemap's accurate water mask the ZIP colors over water —
 * no geometry clipping needed. */
function waterLayerId(m: maplibregl.Map): string | undefined {
  for (const layer of m.getStyle().layers ?? []) {
    const srcLayer = (layer as { "source-layer"?: string })["source-layer"];
    if (layer.type === "fill" && (srcLayer === "water" || layer.id === "water")) return layer.id;
  }
  return undefined;
}

export default function MapView({
  geojson,
  isochrone,
  records,
  activeMetric,
  stops,
  budget,
  work,
  onWorkChange,
  work2,
  onWork2Change,
  recenterSignal,
  fitBbox,
  fitInitialBounds,
  selectedZip,
  pinnedZip,
  onSelectZip,
  stateCode,
  focusPoint,
  focusSignal,
  pinHint,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const loaded = useRef(false);
  const marker = useRef<maplibregl.Marker | null>(null);
  const marker2 = useRef<maplibregl.Marker | null>(null);
  const badgeA = useRef<HTMLSpanElement | null>(null);
  const infoPopup = useRef<maplibregl.Popup | null>(null);

  // Keep the latest props in refs so the sync functions — which may be invoked
  // from the once-bound "load" handler with a stale closure — always read the
  // current data. Without this, a geojson that arrives before the basemap
  // finishes loading is dropped and the choropleth never renders.
  const onWorkChangeRef = useRef(onWorkChange);
  onWorkChangeRef.current = onWorkChange;
  const onWork2ChangeRef = useRef(onWork2Change);
  onWork2ChangeRef.current = onWork2Change;
  const workRef = useRef(work);
  workRef.current = work;
  const geojsonRef = useRef(geojson);
  geojsonRef.current = geojson;
  const isochroneRef = useRef(isochrone);
  isochroneRef.current = isochrone;
  const budgetRef = useRef(budget);
  budgetRef.current = budget;
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const stateCodeRef = useRef(stateCode);
  stateCodeRef.current = stateCode;
  const metricRef = useRef(activeMetric);
  metricRef.current = activeMetric;
  const stopsRef = useRef(stops);
  stopsRef.current = stops;
  const onSelectZipRef = useRef(onSelectZip);
  onSelectZipRef.current = onSelectZip;
  const selectedZipRef = useRef(selectedZip);
  selectedZipRef.current = selectedZip;
  const pinnedZipRef = useRef(pinnedZip);
  pinnedZipRef.current = pinnedZip;

  // Repaint the choropleth from the current metric + per-state stops.
  function applyFill() {
    const m = map.current;
    if (!m || !loaded.current || !m.getLayer(ZIP_FILL)) return;
    m.setPaintProperty(
      ZIP_FILL,
      "fill-color",
      fillColorExpression(metricRef.current.property, stopsRef.current) as never,
    );
  }

  // Create the map once.
  useEffect(() => {
    if (!container.current) return;
    const m = new maplibregl.Map({
      container: container.current,
      style: BASEMAP_STYLE_URL,
      center: MAP_CENTER,
      zoom: MAP_ZOOM,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    // Draggable work-location pin — the brand shield in a circular badge, so
    // the marker reads as part of the product, not a stock teardrop. The "A"
    // label only shows while a second pin exists (016 R1).
    const { el: pinEl, badge } = makePinElement("A");
    badgeA.current = badge;
    badge.style.display = "none";
    const pin = new maplibregl.Marker({ element: pinEl, draggable: true, anchor: "center" })
      .setLngLat([workRef.current.lon, workRef.current.lat])
      .setPopup(
        new maplibregl.Popup({ closeButton: false, offset: 22 }).setText(
          // First visit: actionable label, opened immediately — the welcome
          // modal says "drag the pin" but nothing on the map identifies it.
          pinHint ? "Drag me to your workplace" : "Work location",
        ),
      )
      .addTo(m);
    if (pinHint) pin.togglePopup();
    pin.on("dragend", () => {
      const p = pin.getLngLat();
      onWorkChangeRef.current(p.lat, p.lng);
    });
    marker.current = pin;

    // Hover/tap a ZIP to show its median value. Layer-scoped handlers fire only
    // for the zip-fill layer and work even though it's added after this binding.
    const info = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
    infoPopup.current = info;
    const showInfo = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      m.getCanvas().style.cursor = "pointer";
      const zip = ((f.properties ?? {}) as { zip?: string }).zip ?? "";
      info
        .setLngLat(e.lngLat)
        .setHTML(buildZipPopupHtml(zip, recordsRef.current.get(zip), stateCodeRef.current))
        .addTo(m);
    };
    m.on("mousemove", ZIP_FILL, showInfo);
    // Click = select (009 R1): opens the detail panel; the hover tooltip is
    // dismissed so it doesn't sit on top of the outline.
    m.on("click", ZIP_FILL, (e) => {
      const zip = ((e.features?.[0]?.properties ?? {}) as { zip?: string }).zip;
      if (!zip) return;
      info.remove();
      onSelectZipRef.current(zip);
    });
    m.on("mouseleave", ZIP_FILL, () => {
      m.getCanvas().style.cursor = "";
      info.remove();
    });

    m.on("load", () => {
      loaded.current = true;
      const hatch = hatchImage();
      if (hatch && !m.hasImage(HATCH_IMAGE)) m.addImage(HATCH_IMAGE, hatch, { pixelRatio: 2 });
      syncZips();
      syncIsochrone();
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      marker.current = null;
      infoPopup.current = null;
      loaded.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Choropleth: add or update the source + fill/border layers.
  function syncZips() {
    const m = map.current;
    const data = geojsonRef.current;
    if (!m || !loaded.current || !data) return;
    const existing = m.getSource(ZIP_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (existing) {
      existing.setData(data as never);
      applyFill(); // new state's data -> repaint with its per-state stops
      return;
    }
    m.addSource(ZIP_SOURCE, { type: "geojson", data: data as never });
    // Insert the choropleth beneath the basemap's opaque water layer, so water,
    // roads, and labels all render on top — the basemap's accurate water masks
    // the ZIP colors over Puget Sound / lakes without clipping the geometry.
    const anchor = waterLayerId(m) ?? firstSymbolLayerId(m);
    m.addLayer(
      {
        id: ZIP_FILL,
        type: "fill",
        source: ZIP_SOURCE,
        paint: {
          "fill-color": fillColorExpression(
            metricRef.current.property,
            stopsRef.current,
          ) as never,
          "fill-opacity": fillOpacityExpression(
            budgetRef.current,
            IN_BUDGET_OPACITY,
            OVER_BUDGET_OPACITY,
          ) as never,
        },
      },
      anchor,
    );
    // Over-budget hatch (017 R3): a fill-pattern pass over the dimmed fill so
    // "too expensive" can't be mistaken for water. The filter does all the
    // work — with no budget it matches nothing and the layer paints empty.
    m.addLayer(
      {
        id: ZIP_OVERBUDGET,
        type: "fill",
        source: ZIP_SOURCE,
        filter: overBudgetFilter(budgetRef.current) as never,
        paint: { "fill-pattern": HATCH_IMAGE, "fill-opacity": 0.5 },
      },
      anchor,
    );
    m.addLayer(
      {
        id: "zip-border",
        type: "line",
        source: ZIP_SOURCE,
        paint: { "line-color": "#ffffff", "line-width": 0.6, "line-opacity": 0.7 },
      },
      anchor,
    );
    // Selection outlines (009 R1/R7): filter-based so they survive setData and
    // need no feature-state bookkeeping. Above the basemap labels' anchor so
    // the highlight is never buried.
    m.addLayer({
      id: ZIP_SELECTED,
      type: "line",
      source: ZIP_SOURCE,
      filter: zipFilter(selectedZipRef.current),
      paint: { "line-color": "#e64a19", "line-width": 2.5 },
    });
    m.addLayer({
      id: ZIP_PINNED,
      type: "line",
      source: ZIP_SOURCE,
      filter: zipFilter(pinnedZipRef.current),
      paint: { "line-color": "#1a2230", "line-width": 2, "line-dasharray": [2, 2] },
    });
  }

  // Commute isochrone overlay (the work pin is managed separately). A null
  // overlay CLEARS the source — leaving stale bands painted while a dual-pin
  // intersection recomputes made the display read as a union (016 fix).
  function syncIsochrone() {
    const m = map.current;
    const data = isochroneRef.current;
    if (!m || !loaded.current) return;
    const existing = m.getSource(ISO_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (existing) {
      existing.setData((data ?? { type: "FeatureCollection", features: [] }) as never);
      return;
    }
    if (!data) return;
    m.addSource(ISO_SOURCE, { type: "geojson", data: data as never });
    // Outline-only (no fill) per departure scenario, so the map below stays
    // readable; kept beneath the basemap labels.
    const lineColor: unknown[] = ["match", ["get", "scenario"]];
    for (const s of SCENARIO_STYLES) lineColor.push(s.key, s.line);
    lineColor.push("#888888"); // fallback (e.g. fixture's "typical")
    m.addLayer(
      {
        id: ISO_LINE,
        type: "line",
        source: ISO_SOURCE,
        paint: { "line-color": lineColor as never, "line-width": 2 },
      },
      firstSymbolLayerId(m),
    );
  }

  // Second work pin (016 R1): created/removed as work2 toggles.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (badgeA.current) badgeA.current.style.display = work2 ? "" : "none";
    if (!work2) {
      marker2.current?.remove();
      marker2.current = null;
      return;
    }
    if (!marker2.current) {
      const { el } = makePinElement("B");
      const pin = new maplibregl.Marker({ element: el, draggable: true, anchor: "center" })
        .setLngLat([work2.lon, work2.lat])
        .setPopup(
          new maplibregl.Popup({ closeButton: false, offset: 22 }).setText("Work location B"),
        )
        .addTo(m);
      pin.on("dragend", () => {
        const p = pin.getLngLat();
        onWork2ChangeRef.current(p.lat, p.lng);
      });
      marker2.current = pin;
    } else {
      marker2.current.setLngLat([work2.lon, work2.lat]);
    }
  }, [work2]);

  // Re-sync layers when data arrives.
  useEffect(syncZips, [geojson]);
  useEffect(syncIsochrone, [isochrone]);

  // Track selection/pin changes on the outline layers.
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded.current || !m.getLayer(ZIP_SELECTED)) return;
    m.setFilter(ZIP_SELECTED, zipFilter(selectedZip));
    m.setFilter(ZIP_PINNED, zipFilter(pinnedZip));
  }, [selectedZip, pinnedZip]);

  // Reflect external work-location changes (address / reset) on the pin.
  useEffect(() => {
    marker.current?.setLngLat([work.lon, work.lat]);
  }, [work.lat, work.lon]);

  // Fly to the work location when asked (address search / reset). Skips the
  // initial render (signal 0) so the map keeps its metro-wide opening view.
  useEffect(() => {
    const m = map.current;
    if (!m || recenterSignal === 0) return;
    m.flyTo({
      center: [workRef.current.lon, workRef.current.lat],
      zoom: Math.max(m.getZoom(), 11),
      duration: 800,
    });
  }, [recenterSignal]);

  // Budget changes only repaint opacity + the hatch filter — no data mutation
  // (R4, 017 R3).
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded.current || !m.getLayer(ZIP_FILL)) return;
    m.setPaintProperty(
      ZIP_FILL,
      "fill-opacity",
      fillOpacityExpression(budget, IN_BUDGET_OPACITY, OVER_BUDGET_OPACITY) as never,
    );
    if (m.getLayer(ZIP_OVERBUDGET)) {
      m.setFilter(ZIP_OVERBUDGET, overBudgetFilter(budget) as never);
    }
  }, [budget]);

  // Metric or per-state stops changed -> repaint the choropleth.
  useEffect(() => {
    applyFill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMetric, stops]);

  // Fit the map to the selected region's bounds. The first fit is skipped to
  // preserve the opening metro view — unless a URL deep link asked for it.
  const firstFit = useRef(true);
  useEffect(() => {
    const m = map.current;
    if (!m || !fitBbox) return;
    if (firstFit.current) {
      firstFit.current = false;
      if (!fitInitialBounds) return;
    }
    m.fitBounds(fitBbox, { padding: 40, duration: 800 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitBbox]);

  // Fly to a focus point (top mover click / URL deep-linked ZIP).
  useEffect(() => {
    const m = map.current;
    if (!m || focusSignal === 0 || !focusPoint) return;
    m.flyTo({ center: focusPoint, zoom: Math.max(m.getZoom(), 10.5), duration: 800 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSignal]);

  return <div ref={container} style={{ position: "absolute", inset: 0 }} />;
}
