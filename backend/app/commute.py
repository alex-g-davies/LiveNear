"""Point-to-point commute estimates via the Mapbox Directions API (013 R1/R2).

Drive mode samples the rush window — three departures per leg (AM home→work,
PM work→home, next weekday, origin-local) — and reports the min–max range:
one number was honest about typical traffic but silent about the spread.
Walk/cycle modes are time-invariant, so each leg is a single un-timed call.
Like the other Mapbox clients: the token only builds outbound URLs and never
appears in payloads or logs (R5); endpoints snap to the cache grid; results
(including no-route) are cached 24 h; budget is reserved before any call.
"""

from __future__ import annotations

import datetime
import logging
import time
from typing import Any

import httpx

from . import tzlookup, usage
from .bounded_cache import BoundedCache
from .isochrone import next_departure, snap_origin

logger = logging.getLogger(__name__)

DIRECTIONS_URL = (
    "https://api.mapbox.com/directions/v5/mapbox/{profile}/{from_lon},{from_lat};{to_lon},{to_lat}"
)

# App mode -> Mapbox Directions profile. Public transit is deliberately
# absent: Mapbox has no transit product (013 out-of-scope).
MODE_PROFILES = {"drive": "driving-traffic", "walk": "walking", "cycle": "cycling"}

# Rush-window departures (hour, minute), origin-local (drive mode only).
AM_DEPARTURES = ((7, 15), (8, 0), (8, 45))  # home -> work
PM_DEPARTURES = ((16, 30), (17, 15), (18, 0))  # work -> home

# (mode, from_lon, from_lat, to_lon, to_lat) -> (expires_at, payload-or-None).
# Bounded LRU (004 follow-up): pair keys square the snapped-grid cardinality,
# so a cap matters most here; payloads are small dicts.
_CACHE: BoundedCache[
    tuple[str, float, float, float, float], tuple[float, dict[str, Any] | None]
] = BoundedCache(4096)
CACHE_TTL_SECONDS = 24 * 60 * 60


def clear_cache() -> None:
    _CACHE.clear()


def calls_needed(mode: str) -> int:
    """Upstream calls an uncached estimate spends (budget reservation size)."""
    return len(AM_DEPARTURES) + len(PM_DEPARTURES) if mode == "drive" else 2


def _route_minutes(
    token: str,
    profile: str,
    from_lat: float,
    from_lon: float,
    to_lat: float,
    to_lon: float,
    depart_at: str | None,
) -> int | None:
    """One Directions leg -> predicted minutes, or None when no route exists."""
    url = DIRECTIONS_URL.format(
        profile=profile, from_lon=from_lon, from_lat=from_lat, to_lon=to_lon, to_lat=to_lat
    )
    params: dict[str, Any] = {
        "access_token": token,
        "alternatives": "false",
        "overview": "false",
    }
    if depart_at:
        params["depart_at"] = depart_at
    resp = httpx.get(url, params=params, timeout=15.0)
    resp.raise_for_status()
    body = resp.json()
    if body.get("code") != "Ok" or not body.get("routes"):
        return None
    return round(body["routes"][0]["duration"] / 60)


def _leg(
    token: str,
    profile: str,
    from_lat: float,
    from_lon: float,
    to_lat: float,
    to_lon: float,
    departures: list[str | None],
) -> tuple[int, int] | None:
    """Sampled minutes for one direction -> (min, max); None when every sample
    lacks a route. A partially failing window still yields a (narrower) range."""
    samples = [
        m
        for depart in departures
        if (m := _route_minutes(token, profile, from_lat, from_lon, to_lat, to_lon, depart))
        is not None
    ]
    if not samples:
        return None
    return min(samples), max(samples)


def fetch_commute(
    token: str,
    from_lat: float,
    from_lon: float,
    to_lat: float,
    to_lon: float,
    *,
    mode: str = "drive",
    now: datetime.datetime | None = None,
    daily_budget: int = 0,
) -> dict[str, Any] | None:
    """Both commute legs for a (home, work) pair, cached by snapped endpoints.

    Drive: min–max across the rush-window samples per direction. Walk/cycle:
    a single un-timed duration per direction (min == max, null windows).
    Returns None when either direction has no route. Raises UsageBudgetError
    before any upstream call when the daily budget is exhausted;
    httpx.HTTPError on upstream failure (nothing cached in that case)."""
    profile = MODE_PROFILES[mode]
    from_lat, from_lon = snap_origin(from_lat, from_lon)
    to_lat, to_lon = snap_origin(to_lat, to_lon)
    key = (mode, from_lon, from_lat, to_lon, to_lat)
    clock = time.time()
    hit = _CACHE.get(key)
    if hit and hit[0] > clock:
        return hit[1]

    if not usage.reserve(calls_needed(mode), daily_budget):
        raise usage.UsageBudgetError("daily upstream budget exhausted")

    am_departs: list[str | None]
    pm_departs: list[str | None]
    if mode == "drive":
        # Each leg's window rolls on its ORIGIN's clock (011 R1 semantics).
        am_now = now or datetime.datetime.now(tzlookup.tz_for(from_lat, from_lon))
        pm_now = now or datetime.datetime.now(tzlookup.tz_for(to_lat, to_lon))
        am_departs = [next_departure(h, am_now, minute=m) for h, m in AM_DEPARTURES]
        pm_departs = [next_departure(h, pm_now, minute=m) for h, m in PM_DEPARTURES]
    else:
        am_departs = [None]
        pm_departs = [None]

    logger.info("Fetching commute estimate: mode=%s", mode)  # no coordinates, no token
    am = _leg(token, profile, from_lat, from_lon, to_lat, to_lon, am_departs)
    pm = _leg(token, profile, to_lat, to_lon, from_lat, from_lon, pm_departs)

    payload: dict[str, Any] | None = None
    if am is not None and pm is not None:
        timed = mode == "drive"
        payload = {
            "mode": mode,
            "am_min_minutes": am[0],
            "am_max_minutes": am[1],
            "am_window_start_local": am_departs[0] if timed else None,
            "am_window_end_local": am_departs[-1] if timed else None,
            "pm_min_minutes": pm[0],
            "pm_max_minutes": pm[1],
            "pm_window_start_local": pm_departs[0] if timed else None,
            "pm_window_end_local": pm_departs[-1] if timed else None,
        }
    _CACHE[key] = (clock + CACHE_TTL_SECONDS, payload)
    return payload
