"""Work-location → local timezone (spec 011 R1).

Departure dates for traffic scenarios must roll on the WORK LOCATION's clock:
Mapbox interprets naive depart_at strings as origin-local, so the hour is
right regardless, but rolling "next weekday at 17:00" on a Pacific clock gave
Eastern users past departure times every evening. Split states map to their
dominant zone — a 1-hour error in the minority sliver only shifts which
traffic snapshot is sampled, never the date math's correctness.
"""

from __future__ import annotations

import datetime
from functools import cache
from typing import Any
from zoneinfo import ZoneInfo

from .data_loader import COVERAGE_BUFFER_DEG, load_regions

# Dominant IANA zone per region. Split states (TX, FL, MI, IN, KY, TN, ID,
# OR, ND, SD, NE, KS) use the zone covering most of their population.
STATE_TZ: dict[str, str] = {
    "AL": "America/Chicago",
    "AK": "America/Anchorage",
    "AZ": "America/Phoenix",
    "AR": "America/Chicago",
    "CA": "America/Los_Angeles",
    "CO": "America/Denver",
    "CT": "America/New_York",
    "DE": "America/New_York",
    "DC": "America/New_York",
    "FL": "America/New_York",
    "GA": "America/New_York",
    "HI": "Pacific/Honolulu",
    "ID": "America/Boise",
    "IL": "America/Chicago",
    "IN": "America/New_York",
    "IA": "America/Chicago",
    "KS": "America/Chicago",
    "KY": "America/New_York",
    "LA": "America/Chicago",
    "ME": "America/New_York",
    "MD": "America/New_York",
    "MA": "America/New_York",
    "MI": "America/New_York",
    "MN": "America/Chicago",
    "MS": "America/Chicago",
    "MO": "America/Chicago",
    "MT": "America/Denver",
    "NE": "America/Chicago",
    "NV": "America/Los_Angeles",
    "NH": "America/New_York",
    "NJ": "America/New_York",
    "NM": "America/Denver",
    "NY": "America/New_York",
    "NC": "America/New_York",
    "ND": "America/Chicago",
    "OH": "America/New_York",
    "OK": "America/Chicago",
    "OR": "America/Los_Angeles",
    "PA": "America/New_York",
    "RI": "America/New_York",
    "SC": "America/New_York",
    "SD": "America/Chicago",
    "TN": "America/Chicago",
    "TX": "America/Chicago",
    "UT": "America/Denver",
    "VT": "America/New_York",
    "VA": "America/New_York",
    "WA": "America/Los_Angeles",
    "WV": "America/New_York",
    "WI": "America/Chicago",
    "WY": "America/Denver",
}


def _fallback_tz(lon: float) -> datetime.tzinfo:
    """Crude longitude-derived fixed offset — only used off-coverage, where
    being an hour off merely shifts which traffic snapshot gets sampled."""
    offset = max(-12, min(12, round(lon / 15)))
    return datetime.timezone(datetime.timedelta(hours=offset))


def region_for(lat: float, lon: float) -> dict[str, Any] | None:
    """The region containing (lat, lon), or None off-coverage.

    Containing-bbox lookup (with the geofence buffer), ties broken by distance
    to the region center — the same rule the frontend uses to geolocate."""
    best: dict[str, Any] | None = None
    best_dist = float("inf")
    for r in load_regions():
        bbox = r.get("bbox")
        if not bbox:
            continue
        west, south, east, north = bbox
        if not (
            south - COVERAGE_BUFFER_DEG <= lat <= north + COVERAGE_BUFFER_DEG
            and west - COVERAGE_BUFFER_DEG <= lon <= east + COVERAGE_BUFFER_DEG
        ):
            continue
        center = r.get("center") or [(west + east) / 2, (south + north) / 2]
        d_lat = lat - center[1]
        d_lon = (lon - center[0]) * 0.7  # rough cos(lat) for the US
        dist = d_lat * d_lat + d_lon * d_lon
        if dist < best_dist:
            best_dist = dist
            best = r
    return best


def tz_for(lat: float, lon: float) -> datetime.tzinfo:
    """Local timezone of the region containing (lat, lon): the zone the region
    declares (026 R13), else the US state table, else a longitude estimate."""
    region = region_for(lat, lon)
    name = (region.get("timezone") or STATE_TZ.get(region["code"])) if region else None
    if name is None:
        return _fallback_tz(lon)
    return _zoneinfo(name)


@cache
def _zoneinfo(name: str) -> ZoneInfo:
    return ZoneInfo(name)
