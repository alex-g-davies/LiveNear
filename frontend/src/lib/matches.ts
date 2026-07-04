// Ranked "affordable AND commutable" shortlist (spec 019 R1) — the map shows
// the answer; this states it. Pure computation over data the app has already
// loaded: records, per-ZIP centroids, and the active isochrone collection
// (which in dual mode is already the intersection, so no extra logic).

import type { FeatureCollection } from "geojson";

import type { ZipValue } from "../api/client";
import type { LonLat } from "./geo";
import { scenariosContaining } from "./geo";

export interface ZipMatch {
  zip: string;
  name: string | null;
  median_value: number;
  price_to_income: number | null;
}

export interface MatchResult {
  /** Ranked matches, capped at the display limit. */
  matches: ZipMatch[];
  /** Total qualifying ZIPs (the summary count). */
  total: number;
}

export const MATCH_LIMIT = 8;

/** Ranking (019 R2): price-to-income ascending — the app's own affordability
 * signal (014) — with ratio-less ZIPs after rated ones, then median value
 * ascending as the tiebreak. */
function compareMatches(a: ZipMatch, b: ZipMatch): number {
  const pa = a.price_to_income;
  const pb = b.price_to_income;
  if (pa != null && pb != null && pa !== pb) return pa - pb;
  if (pa != null && pb == null) return -1;
  if (pa == null && pb != null) return 1;
  return a.median_value - b.median_value;
}

/** ZIPs within budget AND within commute reach, ranked. A ZIP is reachable
 * when its centroid lies inside the "typical" (midday) band — the app's
 * honest default framing (011); if the collection carries no typical band
 * (an upstream scenario was skipped), any contained band qualifies. */
export function computeMatches(
  records: Map<string, ZipValue>,
  centroids: Map<string, LonLat>,
  isochrone: FeatureCollection | null,
  budget: number,
  limit: number = MATCH_LIMIT,
): MatchResult {
  if (!isochrone || isochrone.features.length === 0) return { matches: [], total: 0 };
  const hasTypical = isochrone.features.some(
    (f) => (f.properties as { scenario?: string } | null)?.scenario === "typical",
  );
  const qualifying: ZipMatch[] = [];
  for (const [zip, record] of records) {
    if (budget > 0 && record.median_value > budget) continue;
    const centroid = centroids.get(zip);
    if (!centroid) continue;
    const contained = scenariosContaining(centroid, isochrone);
    const reachable = hasTypical ? contained.includes("typical") : contained.length > 0;
    if (!reachable) continue;
    qualifying.push({
      zip,
      name: record.name,
      median_value: record.median_value,
      price_to_income: record.price_to_income,
    });
  }
  qualifying.sort(compareMatches);
  return { matches: qualifying.slice(0, limit), total: qualifying.length };
}
