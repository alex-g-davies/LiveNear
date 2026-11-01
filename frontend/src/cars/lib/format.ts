// NOK formatting for the cars module (spec 022 R11). Amounts arrive as integer
// øre; rounding to whole kroner happens here and nowhere else. Grouping uses
// nb-NO style: a no-break space between thousands, a comma for decimals. We
// group by hand rather than via Intl so the output is identical on every
// ICU build (Node, jsdom, browsers).

const NBSP = " ";

function groupDigits(n: number): string {
  const s = String(Math.abs(Math.round(n)));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** Integer øre -> "12 345 kr" (no decimals). */
export function formatNok(ore: number): string {
  const kr = Math.round(ore / 100);
  const sign = kr < 0 ? "-" : "";
  return `${sign}${groupDigits(kr)}${NBSP}kr`;
}

/** Integer øre -> "+1 234 kr" / "-1 234 kr" / "0 kr". */
export function formatNokSigned(ore: number): string {
  const kr = Math.round(ore / 100);
  const sign = kr > 0 ? "+" : kr < 0 ? "-" : "";
  return `${sign}${groupDigits(kr)}${NBSP}kr`;
}

/** Whole kroner (not øre), e.g. a user-typed limit: 450000 -> "450 000 kr". */
export function formatKr(nok: number): string {
  return formatNok(nok * 100);
}

/** Øre per km -> "5,27 kr/km". */
export function formatPerKm(orePerKm: number): string {
  const kr = orePerKm / 100;
  const fixed = Math.abs(kr).toFixed(2).replace(".", ",");
  return `${kr < 0 ? "-" : ""}${fixed}${NBSP}kr/km`;
}

/** Percent with nb-NO spacing: 15 -> "15 %", (4.5, 1) -> "4,5 %". */
export function formatPct(value: number, decimals = 0): string {
  const s = value.toFixed(decimals).replace(".", ",");
  return `${s}${NBSP}%`;
}

/** Kilometres with grouping: 12000 -> "12 000 km". */
export function formatKm(km: number): string {
  return `${groupDigits(km)}${NBSP}km`;
}

/** Months of ownership -> "1 year", "2.5 years", "6 months". */
export function formatMonths(months: number): string {
  if (months < 12) return `${months} months`;
  const years = months / 12;
  const text = Number.isInteger(years) ? String(years) : years.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${text} ${years === 1 ? "year" : "years"}`;
}

/** Years (may be fractional) -> "2 years", "2.5 years". */
export function formatYears(years: number): string {
  const text = Number.isInteger(years) ? String(years) : String(years);
  return `${text} ${years === 1 ? "year" : "years"}`;
}

/** ISO date passthrough with a dash for missing values. */
export function formatDate(iso: string | null | undefined): string {
  return iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : "—";
}
