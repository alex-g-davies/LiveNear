// Vehicle catalogue (GET /api/cars/vehicles), loaded once per mount.

import { useEffect, useState } from "react";

import { getVehicles, type VehicleOut } from "../api";

export interface VehiclesState {
  data: VehicleOut[] | null;
  loading: boolean;
  error: string | null;
}

export function useVehicles(): VehiclesState {
  const [data, setData] = useState<VehicleOut[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    getVehicles(ctrl.signal)
      .then((v) => !cancelled && (setData(v), setError(null)))
      .catch((e: unknown) => {
        if (cancelled || (e instanceof DOMException && e.name === "AbortError")) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, []);

  return { data, loading, error };
}
