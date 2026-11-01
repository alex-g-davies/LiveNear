// Scenario POST hook (spec 022 R10): 300 ms debounce, AbortController, keeps
// the last good response while a new one loads, surfaces errors as text.

import { useEffect, useState } from "react";

import { postScenario, type ScenarioRequest, type ScenarioResponse } from "../api";

export interface ScenarioState {
  data: ScenarioResponse | null;
  loading: boolean;
  error: string | null;
}

export const SCENARIO_DEBOUNCE_MS = 300;

export function useScenario(request: ScenarioRequest | null): ScenarioState {
  // Key on the serialized body so a re-render with an equal object does not
  // refire; the same string is what goes over the wire anyway.
  const key = request ? JSON.stringify(request) : null;
  const [data, setData] = useState<ScenarioResponse | null>(null);
  const [loading, setLoading] = useState(key !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (key === null) {
      setLoading(false);
      return;
    }
    const body = JSON.parse(key) as ScenarioRequest;
    const ctrl = new AbortController();
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(() => {
      postScenario(body, ctrl.signal)
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
    }, SCENARIO_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [key]);

  return { data, loading, error };
}
