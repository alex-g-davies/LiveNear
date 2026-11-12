// Test helpers for spec 028 R5/R13: find English left on a page rendered in
// another language. Text inside an element marked `lang="en"` (R7 prose) is
// skipped, and so are brand and source names (R8).

import { act } from "@testing-library/react";

import { setLanguage, type Lang } from "../i18n/core";

/** Switch language inside `act`, so subscribed components re-render. */
export async function useLanguage(lang: Lang): Promise<void> {
  await act(() => setLanguage(lang, false));
}

// Common English words that no Bokmål or Turkish UI string should contain.
const ENGLISH_WORDS = [
  "the", "and", "your", "you", "with", "from", "this", "that", "per", "for", "of", "to", "in", "on",
  "is", "are", "not", "or", "a", "an", "show", "hide", "add", "remove", "open", "close", "back",
  "next", "save", "copy", "share", "loading", "error", "price", "cost", "costs", "value", "month",
  "months", "year", "years", "home", "work", "commute", "budget", "car", "cars", "lease", "loan",
  "buy", "sell", "insurance", "compare", "checklist", "market", "detail", "situation", "estimate",
  "source", "about", "help", "search", "map", "area", "areas", "drive", "minutes", "min", "total",
];
const WORD_RE = new RegExp(`(^|[^\\p{L}])(${ENGLISH_WORDS.join("|")})(?=$|[^\\p{L}])`, "giu");

// Names that stay as they are in every language (R8), removed before checking.
const NAMES = /LiveNear|DriveCheap|SSB|Kartverket|Statens vegvesen|Skatteetaten|Norges Bank|Zillow|Redfin|Mapbox|FINN(\.no)?|Geonorge|OpenStreetMap|MapLibre|EU-kontroll/g;

// Words that are English but also correct Bokmål or Turkish, so not leftovers.
const SHARED = new Set(["service", "min", "a", "per", "total", "for", "to", "on", "is", "and"]);

function visibleTexts(root: HTMLElement): { text: string; el: Element }[] {
  const out: { text: string; el: Element }[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || el.closest('[lang="en"], script, style, [aria-hidden="true"], option[lang]')) continue;
    const text = (node.textContent ?? "").trim();
    if (text) out.push({ text, el });
  }
  for (const el of root.querySelectorAll("[aria-label], [title], [placeholder], [alt]")) {
    if (el.closest('[lang="en"]')) continue;
    for (const attr of ["aria-label", "title", "placeholder", "alt"]) {
      const v = el.getAttribute(attr)?.trim();
      if (v) out.push({ text: v, el });
    }
  }
  return out;
}

/** Visible strings that still look English, for a page rendered in nb or tr. */
export function englishLeftovers(root: HTMLElement, allow: readonly (string | RegExp)[] = []): string[] {
  const found = new Set<string>();
  for (const { text } of visibleTexts(root)) {
    if (allow.some((a) => (typeof a === "string" ? text === a : a.test(text)))) continue;
    const stripped = text.replace(NAMES, " ");
    for (const m of stripped.matchAll(WORD_RE)) {
      if (!SHARED.has(m[2].toLowerCase())) {
        found.add(text);
        break;
      }
    }
  }
  return [...found];
}

/** Raw keys or unfilled `{placeholders}` anywhere on the page (R13). */
export function rawKeys(root: HTMLElement): string[] {
  return visibleTexts(root)
    .map((x) => x.text)
    .filter((text) => /\{\w+\}/.test(text) || /\b(common|landing|map|carsPlan|carsCompare|backend)\.[\w.]+/.test(text));
}
