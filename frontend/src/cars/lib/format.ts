// NOK formatting for the cars module (spec 022 R11). Amounts arrive as integer
// øre; rounding to whole kroner happens here and nowhere else. Grouping uses
// nb-NO style: a no-break space between thousands, a comma for decimals. We
// group by hand rather than via Intl so the output is identical on every
// ICU build (Node, jsdom, browsers).

import { dayMonthYear, monthsText, yearsText } from "../../i18n/dates";

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

/** Months of ownership -> "1 year", "2.5 years", "6 months", in the site
 *  language (028 R11). */
export function formatMonths(months: number): string {
  if (months < 12) return monthsText(months);
  return yearsText(months / 12);
}

/** Years (may be fractional) -> "2 years", "2.5 years". */
export function formatYears(years: number): string {
  return yearsText(years);
}

/** Provenance text for display (027 R6). The data marks defaults with no
 *  external source as "Placeholder" and user-entered values as "Owner input";
 *  readers see "Typical value" and "Your input". The status badge and basis
 *  still say it is an estimate, so nothing is hidden, only renamed. */
export function plainSource(text: string | null | undefined): string {
  if (!text) return "";
  const { prefix, rest } = sourceParts(text);
  return readableDates((prefix ? SOURCE_PREFIX_EN[prefix] : "") + rest);
}

/** The relabelled prefix of a provenance text, kept apart from the rest so
 *  other languages can translate the prefix while the rest stays English
 *  backend prose (028 R7). */
export type SourcePrefix = "typical" | "yours";

const SOURCE_PREFIX_EN: Record<SourcePrefix, string> = { typical: "Typical value", yours: "Your input" };

const RELABEL: [RegExp, SourcePrefix, string][] = [
  [/^Placeholder(?=\s+[a-z])(?!\s+until\b)/, "typical", ":"], // "…: winter uplift"
  [/^Placeholder\b/, "typical", ""],
  [/^Owner input\b/, "yours", ""],
];

/** Split a provenance text into its relabelled prefix (if any) and the rest,
 *  e.g. "Placeholder winter uplift" -> typical + ": winter uplift". The rest
 *  has no ISO dates rewritten yet. */
export function sourceParts(text: string): { prefix: SourcePrefix | null; rest: string } {
  for (const [re, prefix, sep] of RELABEL) {
    const m = re.exec(text);
    if (m) return { prefix, rest: sep + text.slice(m[0].length) };
  }
  return { prefix: null, rest: text.replace(/^Owner enters\b/, "You enter") };
}

/** ISO dates inside free text -> "6 Aug 2026" (027 R7), the rest untouched. */
export function readableDates(text: string): string {
  return text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (iso) => formatDate(iso));
}

/** ISO date -> "1 Jan 2027" (027 R7), "1. jan. 2027" or "1 Oca 2027" by site
 *  language (028 R11); a dash for missing values. */
export function formatDate(iso: string | null | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m) return "—";
  return dayMonthYear(Number(m[3]), Number(m[2]) - 1, m[1]);
}
