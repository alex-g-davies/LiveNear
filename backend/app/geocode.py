"""Forward-geocoding via the Mapbox Geocoding API.

Like the isochrone client, the token is used only to build the outbound URL and
never appears in the returned payload or logs (R5). Results are cached by query.
"""

from __future__ import annotations

import logging
import time
from typing import Any
from urllib.parse import quote

import httpx

from . import usage
from .bounded_cache import BoundedCache
from .isochrone import snap_origin

logger = logging.getLogger(__name__)

GEOCODE_URL = "https://api.mapbox.com/geocoding/v5/mapbox.places/{query}.json"

# Cache: normalized query (forward) or "rev|lon,lat" (reverse, snapped) ->
# (expires_at, result-or-None). None caches a miss. Bounded LRU (004
# follow-up): entries are tiny, but user-supplied queries make the key space
# effectively unbounded without a cap.
_CACHE: BoundedCache[str, tuple[float, dict[str, Any] | None]] = BoundedCache(4096)
CACHE_TTL_SECONDS = 24 * 60 * 60


def clear_cache() -> None:
    _CACHE.clear()


def reverse_geocode(
    token: str, lat: float, lon: float, daily_budget: int = 0
) -> dict[str, Any] | None:
    """Nearest address for a point (spec 015 R1). The input is snapped to the
    isochrone cache grid FIRST, so the address updates exactly when the reach
    does and cache cardinality stays bounded (004 R2 argument). Returns None
    when nothing is found; misses are cached. Raises httpx.HTTPError upstream,
    UsageBudgetError when the daily budget is exhausted."""
    lat, lon = snap_origin(lat, lon)
    key = f"rev|{lon},{lat}"
    now = time.time()
    hit = _CACHE.get(key)
    if hit and hit[0] > now:
        return hit[1]

    if not usage.reserve(1, daily_budget):
        raise usage.UsageBudgetError("daily upstream budget exhausted")

    url = GEOCODE_URL.format(query=f"{lon},{lat}")
    params = {"access_token": token, "limit": 1, "types": "address", "country": "us"}
    logger.info("Reverse geocoding a pin position")  # no coordinates, no token
    resp = httpx.get(url, params=params, timeout=10.0)
    resp.raise_for_status()

    features = resp.json().get("features", [])
    result: dict[str, Any] | None = None
    if features:
        f_lon, f_lat = features[0]["center"]
        result = {"lat": f_lat, "lon": f_lon, "place_name": features[0].get("place_name", "")}

    _CACHE[key] = (now + CACHE_TTL_SECONDS, result)
    return result


def forward_geocode(
    token: str,
    query: str,
    proximity_lon: float | None = None,
    proximity_lat: float | None = None,
    daily_budget: int = 0,
) -> dict[str, Any] | None:
    """Resolve an address/place to {lat, lon, place_name}, biased toward the
    proximity point when one is given (unbiased US-wide otherwise, 010 R3).
    Returns None when there is no match. Raises httpx.HTTPError on upstream
    failure, UsageBudgetError when the daily budget is exhausted (cache hits,
    including cached misses, are free)."""
    has_proximity = proximity_lon is not None and proximity_lat is not None
    # The bias changes the answer, so it must be part of the cache key —
    # otherwise a Texas-biased result would be served to a Washington user.
    bias = f"{round(proximity_lon, 1)},{round(proximity_lat, 1)}" if has_proximity else "none"
    key = f"{query.strip().lower()}|{bias}"
    now = time.time()
    hit = _CACHE.get(key)
    if hit and hit[0] > now:
        return hit[1]

    if not usage.reserve(1, daily_budget):
        raise usage.UsageBudgetError("daily upstream budget exhausted")

    url = GEOCODE_URL.format(query=quote(query.strip()))
    params = {
        "access_token": token,
        "limit": 1,
        "country": "us",
    }
    if has_proximity:
        params["proximity"] = f"{proximity_lon},{proximity_lat}"
    logger.info("Geocoding an address query")  # no token, no raw query
    resp = httpx.get(url, params=params, timeout=10.0)
    resp.raise_for_status()

    features = resp.json().get("features", [])
    result: dict[str, Any] | None = None
    if features:
        lon, lat = features[0]["center"]  # Mapbox returns [lon, lat]
        result = {"lat": lat, "lon": lon, "place_name": features[0].get("place_name", query)}

    _CACHE[key] = (now + CACHE_TTL_SECONDS, result)
    return result
