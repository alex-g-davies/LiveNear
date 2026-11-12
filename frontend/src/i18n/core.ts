// Site language (spec 028). A small typed catalogue with no dependency:
// `en/index.ts` is the source of truth for keys. The shared English strings
// ship with the entry chunk and each product registers its own with its
// lazy chunk (`registerMap`, `registerCars`); `nb` and `tr` load on
// demand. Without any setup everything is English, so tests that query
// English text keep working.

import type { Dict, Key } from "./en";
import common from "./en/common";
import landing from "./en/landing";

export type Lang = "en" | "nb" | "tr";

export const LANGS: readonly Lang[] = ["en", "nb", "tr"];

/** Full names, each in its own language (R1). */
export const LANG_NAMES: Record<Lang, string> = {
  en: "English",
  nb: "Norsk (bokmål)",
  tr: "Türkçe",
};

/** Short codes shown on the closed picker (R1). */
export const LANG_CODES: Record<Lang, string> = { en: "EN", nb: "NB", tr: "TR" };

/** BCP 47 tags for Intl APIs and `<html lang>`. */
export const LANG_TAGS: Record<Lang, string> = { en: "en", nb: "nb-NO", tr: "tr-TR" };

export const STORAGE_KEY = "livenear.lang";

type PluralBase<K> = K extends `${infer B}_other` ? B : never;
/** A dictionary key, or the base of a `_one`/`_other` pair. */
export type TKey = Key | PluralBase<Key>;
export type Params = Record<string, string | number>;

const loaders: Record<Exclude<Lang, "en">, () => Promise<{ default: Dict }>> = {
  nb: () => import("./nb"),
  tr: () => import("./tr"),
};

// The English catalogue loaded so far. Typed as complete: every lookup falls
// back to the key, and products register their part before they render.
const en = { ...common, ...landing } as Record<string, string> as Dict;

/** Add a product's English strings (called from its lazy chunk). */
export function registerEnglish(part: Record<string, string>): void {
  Object.assign(en, part);
}

let active: { lang: Lang; dict: Dict } = { lang: "en", dict: en };
const listeners = new Set<() => void>();
const pluralRules = new Map<Lang, Intl.PluralRules>();

export function getLang(): Lang {
  return active.lang;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function plural(lang: Lang, n: number): string {
  let rules = pluralRules.get(lang);
  if (!rules) {
    rules = new Intl.PluralRules(LANG_TAGS[lang]);
    pluralRules.set(lang, rules);
  }
  return rules.select(n);
}

function lookup(dict: Dict, key: string): string | undefined {
  return (dict as Record<string, string>)[key];
}

/** True if `key` is in the catalogue (used for keyed backend labels, R6). */
export function hasKey(key: string): boolean {
  return lookup(en, key) !== undefined || lookup(en, `${key}_other`) !== undefined;
}

/** Translate `key` in the active language. `{name}` placeholders come from
 *  `params`; a numeric `count` picks the `_one`/`_other` form. Falls back to
 *  English, then to the key itself (which a test forbids, R13). */
export function t(key: TKey, params?: Params): string {
  return translate(active, key, params);
}

/** Like `t`, for a key only known at runtime (e.g. a backend item key). */
export function tDynamic(key: string, params?: Params): string {
  return translate(active, key, params);
}

function translate(state: { lang: Lang; dict: Dict }, key: string, params?: Params): string {
  let text: string | undefined;
  const count = params?.count;
  if (typeof count === "number" && lookup(en, `${key}_other`) !== undefined) {
    const form = plural(state.lang, count);
    text =
      lookup(state.dict, `${key}_${form}`) ??
      lookup(state.dict, `${key}_other`) ??
      lookup(en, `${key}_${plural("en", count)}`) ??
      lookup(en, `${key}_other`);
  }
  text ??= lookup(state.dict, key) ?? lookup(en, key) ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGS as readonly string[]).includes(value);
}

function fromBrowser(tag: string): Lang | null {
  const base = tag.toLowerCase().split(/[-_]/)[0];
  if (base === "nb" || base === "no" || base === "nn") return "nb";
  if (base === "tr") return "tr";
  if (base === "en") return "en";
  return null;
}

/** The starting language (R2): stored choice, `?lang=`, browser, English. */
export function detectLang(
  stored: string | null,
  search: string,
  browserLangs: readonly string[],
): Lang {
  if (isLang(stored)) return stored;
  const param = new URLSearchParams(search).get("lang");
  if (isLang(param)) return param;
  for (const tag of browserLangs) {
    const lang = fromBrowser(tag);
    if (lang) return lang;
  }
  return "en";
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(lang: Lang): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
}

async function load(lang: Lang): Promise<Dict> {
  if (lang === "en") return en;
  return (await loaders[lang]()).default;
}

function apply(lang: Lang, dict: Dict): void {
  active = { lang, dict };
  if (typeof document !== "undefined") document.documentElement.lang = LANG_TAGS[lang];
  listeners.forEach((listener) => listener());
}

/** Switch language (R3). `persist` records a visitor's own choice. */
export async function setLanguage(lang: Lang, persist = true): Promise<void> {
  const dict = await load(lang);
  if (persist) writeStored(lang);
  apply(lang, dict);
}

/** Remove `?lang=` from the address bar once read, so links copied or built
 *  from the current URL never carry a language (R4). */
export function dropLangParam(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("lang")) return;
    url.searchParams.delete("lang");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // No history API: nothing to tidy.
  }
}

/** Pick and load the starting language before the first render, so a
 *  Norwegian visitor never sees English flash first. */
export async function initLanguage(): Promise<Lang> {
  const nav = typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language];
  const lang = detectLang(readStored(), window.location.search, nav);
  dropLangParam();
  try {
    await setLanguage(lang, false);
  } catch {
    apply("en", en);
  }
  return active.lang;
}

/** Back to English (tests). */
export function resetLanguage(): void {
  apply("en", en);
}
