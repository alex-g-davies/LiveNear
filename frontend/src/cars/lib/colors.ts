// Stable colour per car (variant) across the Compare and Detail screens:
// order follows the user's selection, then any extra variants the response
// happens to contain.

import { useCallback, useMemo } from "react";

import type { ScenarioResponse } from "../api";
import { colorForIndex } from "./measures";
import type { SelectionItem } from "./profile";

export function useColorOf(selection: SelectionItem[], data: ScenarioResponse | null) {
  const map = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of selection) if (!m.has(s.variant_id)) m.set(s.variant_id, colorForIndex(m.size));
    for (const o of data?.options ?? []) if (!m.has(o.variant_id)) m.set(o.variant_id, colorForIndex(m.size));
    return m;
  }, [selection, data]);
  return useCallback((variantId: string) => map.get(variantId) ?? colorForIndex(map.size), [map]);
}
