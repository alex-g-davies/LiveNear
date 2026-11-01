// Market data hook (spec 023 R2): cohorts and per-listing points for a filter
// set, 300 ms debounce, AbortController, last good data kept while loading.

import { useEffect, useState } from "react";

import { getCohorts, getMarketPoints, type CohortsResponse, type MarketFilters, type MarketPointsResponse } from "../api";

export interface MarketState {
  cohorts: CohortsResponse | null;
  points: MarketPointsResponse | null;
  loading: boolean;
  error: string | null;
}

export const MARKET_DEBOUNCE_MS = 300;

export function useMarket(filters: MarketFilters): MarketState {
  const key = JSON.stringify(filters);
  const [cohorts, setCohorts] = useState<CohortsResponse | null>(null);
  const [points, setPoints] = useState<MarketPointsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const f = JSON.parse(key) as MarketFilters;
    const ctrl = new AbortController();
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(() => {
      Promise.all([getCohorts(f, ctrl.signal), getMarketPoints(f, ctrl.signal)])
        .then(([c, p]) => {
          if (cancelled) return;
          setCohorts(c);
          setPoints(p);
          setError(null);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => !cancelled && setLoading(false));
    }, MARKET_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [key]);

  return { cohorts, points, loading, error };
}
