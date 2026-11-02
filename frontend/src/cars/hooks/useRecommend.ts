// Recommendations POST hook (spec 024 R12): same shape as useScenario — 300 ms
// debounce, AbortController, last good response kept while a new one loads.
// Callers pass null until the profile validates (exit odds and charging mix
// both sum to 100 %), so an unfinished form never hits the backend.

import { useEffect, useState } from "react";

import { postRecommend, type RecommendRequest, type RecommendResponse } from "../api";
import { chargingSum, exitOddsSum, type CarProfile, type Measure } from "../lib/profile";
import { SCENARIO_SEED } from "../state";

export interface RecommendState {
  data: RecommendResponse | null;
  loading: boolean;
  error: string | null;
}

export const RECOMMEND_DEBOUNCE_MS = 300;
export const RECOMMEND_DRAWS = 500;
export const RECOMMEND_N = 5;

export function profileValid(profile: CarProfile): boolean {
  return exitOddsSum(profile.exit_odds) === 100 && chargingSum(profile.charging_mix) === 100;
}

/** The request for a profile, or null while the form is not valid yet. */
export function buildRecommendRequest(profile: CarProfile, measure: Measure): RecommendRequest | null {
  if (!profileValid(profile)) return null;
  return { profile, measure, n: RECOMMEND_N, seed: SCENARIO_SEED, draws: RECOMMEND_DRAWS };
}

export function useRecommend(request: RecommendRequest | null): RecommendState {
  const key = request ? JSON.stringify(request) : null;
  const [data, setData] = useState<RecommendResponse | null>(null);
  const [loading, setLoading] = useState(key !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (key === null) {
      setLoading(false);
      return;
    }
    const body = JSON.parse(key) as RecommendRequest;
    const ctrl = new AbortController();
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(() => {
      postRecommend(body, ctrl.signal)
        .then((res) => {
          if (cancelled) return;
          setData(res);
          setError(null);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => !cancelled && setLoading(false));
    }, RECOMMEND_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [key]);

  return { data, loading, error };
}
