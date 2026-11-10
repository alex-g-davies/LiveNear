// Norway publishes average price per m², not a home value, so an estimated
// price is that average times a reference home size the user controls (spec
// 026 R9). Areas without a published m² price (every US ZIP) pass through.

import type { Feature, FeatureCollection } from "geojson";

import type { ZipValue } from "../api/client";

export const DEFAULT_REFERENCE_M2 = 75;
export const MIN_REFERENCE_M2 = 20;
export const MAX_REFERENCE_M2 = 400;

export function validReferenceM2(value: number): boolean {
  return Number.isFinite(value) && value >= MIN_REFERENCE_M2 && value <= MAX_REFERENCE_M2;
}

function sizedRecord(record: ZipValue, m2: number): ZipValue {
  const price = record.price_per_m2;
  if (price == null) return record;
  const estimate = Math.round(price * m2);
  const income = record.median_income;
  return {
    ...record,
    median_value: estimate,
    price_to_income: income ? Math.round((estimate / income) * 10) / 10 : null,
  };
}

/** Records with their estimates at this size. Returns the same Map when no
 * record has a m² price, so US regions never re-render for this. */
export function applyReferenceSize(
  records: Map<string, ZipValue>,
  m2: number,
): Map<string, ZipValue> {
  if (![...records.values()].some((r) => r.price_per_m2 != null)) return records;
  return new Map([...records].map(([id, record]) => [id, sizedRecord(record, m2)]));
}

/** The choropleth with the same estimates, from already-sized records. */
export function applyReferenceSizeToGeojson(
  geojson: FeatureCollection | null,
  sizedRecords: Map<string, ZipValue>,
): FeatureCollection | null {
  if (!geojson) return geojson;
  if (![...sizedRecords.values()].some((r) => r.price_per_m2 != null)) return geojson;
  const features = geojson.features.map((feature): Feature => {
    const record = sizedRecords.get((feature.properties?.zip as string) ?? "");
    if (!record) return feature;
    const properties: Record<string, unknown> = {
      ...feature.properties,
      median_value: record.median_value,
    };
    if (record.price_to_income != null) properties.price_to_income = record.price_to_income;
    return { ...feature, properties };
  });
  return { ...geojson, features };
}
