import type { RegionInfo } from "../api/client";
import { useT } from "../i18n/react";

interface Props {
  regions: RegionInfo[];
  state: string;
  onStateChange: (code: string) => void;
}

/** State selector for the cost layer (national region-on-demand). */
export default function RegionPicker({ regions, state, onStateChange }: Props) {
  const { t } = useT();
  const current = regions.find((r) => r.code === state);
  // The backend sends the English word; known words are translated (028 R9).
  const sent = current?.region_label;
  const label =
    sent === "Fylke"
      ? t("map.locale.no.region")
      : sent == null || sent === "State"
        ? t("map.locale.us.region")
        : sent;
  const option = (r: RegionInfo) => (
    <option key={r.code} value={r.code}>
      {/* Say what the number is — a bare "(484)" reads as noise. */}
      {r.name} ·{" "}
      {t(r.country === "NO" ? "map.region.areas" : "map.region.zips", {
        count: r.zip_count,
        value: r.zip_count,
      })}
    </option>
  );
  const us = regions.filter((r) => (r.country ?? "US") === "US");
  const norway = regions.filter((r) => r.country === "NO");
  return (
    <label className="region">
      <span className="section-label">{label}</span>
      <select
        className="region__select"
        aria-label={label}
        value={state}
        onChange={(e) => onStateChange(e.target.value)}
      >
        {norway.length === 0 ? (
          us.map(option)
        ) : (
          <>
            <optgroup label={t("map.region.us")}>{us.map(option)}</optgroup>
            <optgroup label={t("map.region.no")}>{norway.map(option)}</optgroup>
          </>
        )}
      </select>
    </label>
  );
}
