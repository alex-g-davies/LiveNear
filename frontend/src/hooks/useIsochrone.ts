import { useEffect, useState } from "react";
import type { FeatureCollection } from "geojson";

import { getIsochrone } from "../api/client";
import type { TravelMode, WorkLocation } from "../config";
import type { TKey } from "../i18n/core";

/** Dictionary key of the toast shown when a reach overlay fails (translated
 * where it is shown, spec 028). */
export const NOTICE_ISOCHRONE = "map.notice.isochrone" satisfies TKey;

export interface IsochroneState {
  isochrone: FeatureCollection | null;
  loading: boolean;
  failed: boolean;
}

/**
 * Reach overlay for one work pin (extracted from useMapData for dual-pin
 * support, 016 R2). Null work → idle. Refetches on location/time/mode
 * changes; best-effort (failed flag feeds the toast).
 */
export function useIsochrone(
  work: WorkLocation | null,
  minutes: number,
  mode: TravelMode,
): IsochroneState {
  const [isochrone, setIsochrone] = useState<FeatureCollection | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!work) {
      setIsochrone(null);
      setLoading(false);
      setFailed(false);
      return;
    }
    let cancelled = false;
    // Clear the previous contour up front (016 fix): a stale contour from a
    // prior position would poison the dual-pin intersection if this fetch
    // fails (e.g. rate-limited drag burst). The map chip covers the gap.
    setIsochrone(null);
    setLoading(true);
    getIsochrone(work.lat, work.lon, minutes, mode)
      .then((fc) => {
        if (cancelled) return;
        setIsochrone(fc);
        setFailed(false);
      })
      .catch(() => !cancelled && setFailed(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [work?.lat, work?.lon, minutes, mode, work]);

  return { isochrone, loading, failed };
}
