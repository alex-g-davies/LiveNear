// React access to the site language (spec 028). Components that show text
// call `useT()`; it re-renders them when the language changes (R3). No
// provider is needed, and without one the language is English.

import { useSyncExternalStore } from "react";

import { getLang, subscribe, t, type Lang } from "./core";

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

/** The translate function, subscribed to language changes. Put `lang` in the
 *  dependencies of any memo that calls it. */
export function useT(): { t: typeof t; lang: Lang } {
  const lang = useLang();
  return { t, lang };
}
