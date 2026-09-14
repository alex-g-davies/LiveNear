// Shared value formatting so the legend, popups, and panel stay consistent.

/** Full currency, e.g. 937500 -> "$937,500". */
export function formatUsd(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** Compact currency for tight UI, e.g. 937500 -> "$938k". */
export function formatUsdCompact(value: number): string {
  return `$${Math.round(value / 1000)}k`;
}

/** Signed percent to 1 dp, e.g. 4.2 -> "+4.2%", -1.5 -> "-1.5%". */
export function formatPct(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

/** Price per square foot, e.g. 612 -> "$612/sqft". */
export function formatPpsf(value: number): string {
  return `$${Math.round(value)}/sqft`;
}

/** Area in square miles, e.g. 467.8 -> "468 mi²"; null -> "—". */
export function formatSqMi(value: number | null | undefined): string {
  return value == null ? "—" : `${Math.round(value)} mi²`;
}

/** Thousands-separated count, e.g. 45000 -> "45,000"; null -> "—". */
export function formatCount(value: number | null | undefined): string {
  return value == null ? "—" : value.toLocaleString("en-US");
}

/** Budget input display value: separators while typing, empty for 0 (015 R2). */
export function formatBudgetInput(value: number): string {
  return value > 0 ? value.toLocaleString("en-US") : "";
}

/** Whole-dollar monthly amount, e.g. 3180 -> "$3,180/mo". */
export function formatMonthly(value: number): string {
  return `${formatUsd(value)}/mo`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Data vintage label from an ISO date, e.g. "2026-04-30" -> "Apr 2026";
 * anything unparseable -> "" so callers can simply omit the line. */
export function formatMonthYear(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso ?? "");
  if (!m) return "";
  const month = Number(m[2]);
  if (month < 1 || month > 12) return "";
  return `${MONTHS[month - 1]} ${m[1]}`;
}

/** Affordability multiple, e.g. 6.5 -> "6.5×"; null -> "—". */
export function formatRatio(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(1)}×`;
}

/** Human place label for a ZIP (012 R2): "Gig Harbor, WA 98335" — degrading
 * to "Gig Harbor 98335" without a state code and "ZIP 98335" without a name. */
export function placeLabel(
  zip: string,
  name: string | null | undefined,
  stateCode?: string | null,
): string {
  if (!name) return `ZIP ${zip}`;
  return stateCode ? `${name}, ${stateCode} ${zip}` : `${name} ${zip}`;
}

/** Minute range, e.g. (55, 73) -> "55–73 min", collapsing to "~55 min". */
export function rangeLabel(minMinutes: number, maxMinutes: number): string {
  return minMinutes === maxMinutes
    ? `~${minMinutes} min`
    : `${minMinutes}–${maxMinutes} min`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Naive local departure timestamp -> "Mon 8:00 AM"; bad input -> "". */
export function departLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hours = d.getHours();
  const h12 = hours % 12 || 12;
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${WEEKDAYS[d.getDay()]} ${h12}:${mins} ${hours >= 12 ? "PM" : "AM"}`;
}
