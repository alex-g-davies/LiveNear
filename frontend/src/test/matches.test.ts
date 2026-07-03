import type { FeatureCollection } from "geojson";
import { describe, expect, it } from "vitest";

import type { ZipValue } from "../api/client";
import type { LonLat } from "../lib/geo";
import { computeMatches } from "../lib/matches";

function rec(zip: string, value: number, p2i: number | null = null): ZipValue {
  return {
    zip,
    median_value: value,
    yoy_pct: null,
    cagr5_pct: null,
    ppsf: null,
    history: null,
    population: null,
    median_income: null,
    price_to_income: p2i,
    name: null,
  };
}

/** Square band [0,10]×[0,10] tagged with a scenario key. */
function band(scenario: string, size = 10): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: { scenario },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [size, 0],
          [size, size],
          [0, size],
          [0, 0],
        ],
      ],
    },
  };
}

function fc(...features: GeoJSON.Feature[]): FeatureCollection {
  return { type: "FeatureCollection", features };
}

const INSIDE: LonLat = [5, 5];
const OUTSIDE: LonLat = [50, 50];

describe("computeMatches (019 R1/R2)", () => {
  it("keeps only ZIPs inside the typical band and within budget", () => {
    const records = new Map([
      ["1", rec("1", 400_000)],
      ["2", rec("2", 900_000)], // over budget
      ["3", rec("3", 300_000)], // out of reach
    ]);
    const centroids = new Map<string, LonLat>([
      ["1", INSIDE],
      ["2", INSIDE],
      ["3", OUTSIDE],
    ]);
    const result = computeMatches(records, centroids, fc(band("typical")), 500_000);
    expect(result.matches.map((m) => m.zip)).toEqual(["1"]);
    expect(result.total).toBe(1);
  });

  it("treats no budget (0) as reach-only", () => {
    const records = new Map([
      ["1", rec("1", 400_000)],
      ["2", rec("2", 9_000_000)],
    ]);
    const centroids = new Map<string, LonLat>([
      ["1", INSIDE],
      ["2", INSIDE],
    ]);
    const result = computeMatches(records, centroids, fc(band("typical")), 0);
    expect(result.total).toBe(2);
  });

  it("requires the typical band when present (offpeak-only reach is not a match)", () => {
    // ZIP sits inside the wide offpeak band but outside the typical band.
    const records = new Map([["1", rec("1", 400_000)]]);
    const centroids = new Map<string, LonLat>([["1", [15, 15]]]);
    const iso = fc(band("offpeak", 20), band("typical", 10));
    expect(computeMatches(records, centroids, iso, 0).total).toBe(0);
  });

  it("falls back to any band when no typical band exists", () => {
    const records = new Map([["1", rec("1", 400_000)]]);
    const centroids = new Map<string, LonLat>([["1", INSIDE]]);
    expect(computeMatches(records, centroids, fc(band("offpeak")), 0).total).toBe(1);
  });

  it("ranks by price-to-income, ratio-less last, value as tiebreak", () => {
    const records = new Map([
      ["a", rec("a", 500_000, 6.0)],
      ["b", rec("b", 700_000, 3.5)],
      ["c", rec("c", 200_000, null)], // no ratio -> after rated ZIPs
      ["d", rec("d", 100_000, null)], // no ratio, cheaper -> before c
    ]);
    const centroids = new Map<string, LonLat>(
      [...records.keys()].map((z) => [z, INSIDE] as [string, LonLat]),
    );
    const result = computeMatches(records, centroids, fc(band("typical")), 0);
    expect(result.matches.map((m) => m.zip)).toEqual(["b", "a", "d", "c"]);
  });

  it("caps the list at the limit but reports the true total", () => {
    const records = new Map(
      Array.from({ length: 12 }, (_, i) => [`${i}`, rec(`${i}`, 100_000 + i)] as const),
    );
    const centroids = new Map<string, LonLat>(
      [...records.keys()].map((z) => [z, INSIDE] as [string, LonLat]),
    );
    const result = computeMatches(records, centroids, fc(band("typical")), 0, 8);
    expect(result.matches).toHaveLength(8);
    expect(result.total).toBe(12);
  });

  it("returns empty for a null or empty isochrone", () => {
    const records = new Map([["1", rec("1", 400_000)]]);
    const centroids = new Map<string, LonLat>([["1", INSIDE]]);
    expect(computeMatches(records, centroids, null, 0).total).toBe(0);
    expect(computeMatches(records, centroids, fc(), 0).total).toBe(0);
  });

  it("skips ZIPs with no centroid", () => {
    const records = new Map([["1", rec("1", 400_000)]]);
    expect(computeMatches(records, new Map(), fc(band("typical")), 0).total).toBe(0);
  });
});
