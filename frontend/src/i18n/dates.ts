// Dates and durations in the site language (spec 028 R11). Month names are
// written out by hand, like the cars number formats, so every ICU build
// (Node, jsdom, browsers) prints the same thing.

import { getLang, t, type Lang } from "./core";

const NBSP = " ";

const MONTHS: Record<Lang, readonly string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  nb: ["jan.", "feb.", "mars", "apr.", "mai", "juni", "juli", "aug.", "sep.", "okt.", "nov.", "des."],
  tr: ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"],
};

/** Short month name, 0-based: (0) -> "Jan" / "jan." / "Oca". */
export function monthShort(index: number, lang: Lang = getLang()): string {
  return MONTHS[lang][index] ?? "";
}

/** Day, month, year: "1 Jan 2027", "1. jan. 2027", "1 Oca 2027". */
export function dayMonthYear(day: number, monthIndex: number, year: number | string, lang: Lang = getLang()): string {
  const month = monthShort(monthIndex, lang);
  if (!month) return "—";
  const d = lang === "nb" ? `${day}.` : String(day);
  return `${d}${NBSP}${month}${NBSP}${year}`;
}

/** Month and year: "Jan 2027", "jan. 2027", "Oca 2027". */
export function monthYear(monthIndex: number, year: number | string, lang: Lang = getLang()): string {
  const month = monthShort(monthIndex, lang);
  return month ? `${month}${NBSP}${year}` : "—";
}

/** Decimal separator of the site language for prose numbers ("2.5" / "2,5"). */
export function decimal(text: string, lang: Lang = getLang()): string {
  return lang === "en" ? text : text.replace(".", ",");
}

/** "1 year", "2.5 years", "2,5 år", "2,5 yıl". */
export function yearsText(years: number): string {
  const text = Number.isInteger(years) ? String(years) : years.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return t("common.years", { count: years, value: decimal(text) });
}

/** "6 months", "6 måneder", "6 ay". */
export function monthsText(months: number): string {
  return t("common.months", { count: months, value: String(months) });
}
