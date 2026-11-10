import type { RegionInfo } from "../api/client";

interface Props {
  regions: RegionInfo[];
  state: string;
  onStateChange: (code: string) => void;
}

/** State selector for the cost layer (national region-on-demand). */
export default function RegionPicker({ regions, state, onStateChange }: Props) {
  const current = regions.find((r) => r.code === state);
  const label = current?.region_label ?? "State";
  const option = (r: RegionInfo) => (
    <option key={r.code} value={r.code}>
      {/* Say what the number is — a bare "(484)" reads as noise. */}
      {r.name} · {r.zip_count} {r.country === "NO" ? "areas" : "ZIPs"}
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
            <optgroup label="United States">{us.map(option)}</optgroup>
            <optgroup label="Norway">{norway.map(option)}</optgroup>
          </>
        )}
      </select>
    </label>
  );
}
