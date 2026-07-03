"""Mapbox Isochrone client and response shaping (commute layer, spec 003).

The token is passed in from settings (config.py) and is used ONLY to build the
outbound Mapbox URL. It never appears in the returned payload or in logs (R5).
The pure helpers (strip_mapbox_props, build_collection, next_departure,
geodesic_area_sqmi, summarize_variation) are unit-testable without network.
"""

from __future__ import annotations

import datetime
import logging
import math
import time
from typing import Any

import httpx
from shapely.geometry import mapping, shape

from . import tzlookup, usage
from .bounded_cache import BoundedCache

logger = logging.getLogger(__name__)

ISO_URL = "https://api.mapbox.com/isochrone/v1/mapbox/{profile}/{lon},{lat}"

# Representative weekday departure windows in the WORK LOCATION's local time
# (Mapbox reads naive depart_at as origin-local; the date math rolls on the
# region's clock via tzlookup — spec 011 R1), ordered from largest reach
# (off-peak) to smallest (peak) so features render with the peak band on top.
# Hours chosen from measured outbound reach: 12:00 midday baseline, 17:00 the
# genuine PM-rush low (leaving the workplace), 20:00 light evening traffic.
SCENARIOS: tuple[tuple[str, int, str], ...] = (
    ("offpeak", 20, "Light traffic"),
    ("typical", 12, "Midday"),
    ("peak", 17, "Evening rush"),
)

# Mapbox decorates each feature with styling props; strip them so our payload is
# clean and carries nothing token-derived.
_MAPBOX_STYLE_PROPS = {
    "fill",
    "fillColor",
    "fill-opacity",
    "fillOpacity",
    "color",
    "opacity",
    "stroke",
    "stroke-width",
    "stroke-opacity",
    "metric",
}

# App mode -> Mapbox isochrone profile (013 R2). Walk/cycle are
# time-invariant: one contour, no traffic scenarios.
MODE_PROFILES = {"drive": "driving-traffic", "walk": "walking", "cycle": "cycling"}
MODE_LABELS = {"walk": "Walking", "cycle": "Cycling"}

# In-process TTL cache: (lon, lat, minutes, mode) -> (expires_at, payload).
# Bounded LRU (004 follow-up): payloads run tens of KB, so 512 entries keeps
# the worst case in the tens of MB while comfortably covering a day of
# distinct (origin, minutes, mode) combinations within the daily call budget.
_CACHE: BoundedCache[tuple[float, float, int, str], tuple[float, dict[str, Any]]] = BoundedCache(
    512
)
CACHE_TTL_SECONDS = 24 * 60 * 60

# Origins are snapped to this grid (~500 m) before the cache key and any Mapbox
# call (spec 004 R2): pin micro-drags become cache hits and the worst-case
# unique-key cardinality an abuser can generate is bounded. Half a kilometer is
# visually irrelevant at 15-60-minute contour scale.
SNAP_GRID_DEG = 0.005


def snap_origin(lat: float, lon: float) -> tuple[float, float]:
    """Snap a work location onto the SNAP_GRID_DEG grid."""
    return (
        round(round(lat / SNAP_GRID_DEG) * SNAP_GRID_DEG, 6),
        round(round(lon / SNAP_GRID_DEG) * SNAP_GRID_DEG, 6),
    )


_EARTH_R_M = 6_371_000.0
_SQM_PER_SQMI = 2_589_988.110336


def clear_cache() -> None:
    _CACHE.clear()


def strip_mapbox_props(raw: dict[str, Any], minutes: int) -> list[dict[str, Any]]:
    """Return cleaned features: styling props removed, contour_minutes set."""
    features: list[dict[str, Any]] = []
    for feat in raw.get("features", []) or []:
        props = {
            k: v for k, v in (feat.get("properties") or {}).items() if k not in _MAPBOX_STYLE_PROPS
        }
        props["contour_minutes"] = minutes
        features.append({"type": "Feature", "properties": props, "geometry": feat.get("geometry")})
    return features


def build_collection(
    features: list[dict[str, Any]],
    lat: float,
    lon: float,
    minutes: int,
    variation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Wrap cleaned features into our isochrone FeatureCollection response."""
    return {
        "type": "FeatureCollection",
        "properties": {
            "contour_minutes": minutes,
            "work": {"lat": lat, "lon": lon},
            "variation": variation,
        },
        "features": features,
    }


def next_departure(hour: int, now: datetime.datetime, minute: int = 0) -> str:
    """Next future weekday (Mon-Fri) at `hour`:`minute` local time as ISO
    'YYYY-MM-DDThh:mm' (naive — Mapbox interprets it as origin-local; it must
    be in the future, hence rolling on the origin's clock, spec 011 R1)."""
    cand = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if cand <= now:
        cand += datetime.timedelta(days=1)
    while cand.weekday() >= 5:  # Saturday/Sunday -> roll to Monday
        cand += datetime.timedelta(days=1)
    return cand.strftime("%Y-%m-%dT%H:%M")


def _ring_area_m2(ring: list[list[float]]) -> float:
    """Spherical area of a single [ [lon,lat], ... ] ring, in square meters."""
    if len(ring) < 4:
        return 0.0
    total = 0.0
    for i in range(len(ring) - 1):
        lon1, lat1 = ring[i][0], ring[i][1]
        lon2, lat2 = ring[i + 1][0], ring[i + 1][1]
        total += math.radians(lon2 - lon1) * (
            2 + math.sin(math.radians(lat1)) + math.sin(math.radians(lat2))
        )
    return abs(total * _EARTH_R_M * _EARTH_R_M / 2.0)


def geodesic_area_sqmi(geometry: dict[str, Any] | None) -> float:
    """Approximate area of a (Multi)Polygon geometry in square miles."""
    if not geometry:
        return 0.0
    gtype = geometry.get("type")
    coords = geometry.get("coordinates") or []
    polys = coords if gtype == "MultiPolygon" else [coords] if gtype == "Polygon" else []
    area_m2 = 0.0
    for poly in polys:
        if not poly:
            continue
        area_m2 += _ring_area_m2(poly[0])  # exterior ring
        for hole in poly[1:]:
            area_m2 -= _ring_area_m2(hole)
    return round(area_m2 / _SQM_PER_SQMI, 1)


def enforce_nesting(ordered: list[tuple[str, Any]]) -> list[tuple[str, Any]]:
    """Clip each band to the running outer intersection so they strictly nest
    (peak ⊆ typical ⊆ off-peak). `ordered` is [(scenario, shapely geom)] from
    outer (widest) to inner. Directional traffic can make raw contours cross;
    this guarantees the inner band = area reachable even in worse traffic."""
    out: list[tuple[str, Any]] = []
    acc = None
    for scenario, geom in ordered:
        if not geom.is_valid:
            geom = geom.buffer(0)  # repair self-intersections
        clipped = geom if acc is None else geom.intersection(acc)
        if clipped.is_empty or clipped.geom_type not in ("Polygon", "MultiPolygon"):
            # Degenerate intersection -> keep this band unclipped. The strict
            # peak ⊆ typical ⊆ off-peak guarantee is violated for this
            # response; surface it in logs instead of failing silently.
            logger.warning("Isochrone nesting fallback: %s band kept unclipped", scenario)
            clipped = geom
        out.append((scenario, clipped))
        acc = clipped
    return out


def summarize_variation(areas: dict[str, float]) -> dict[str, Any]:
    """Build the numeric reach-variation summary from per-scenario areas."""
    off, typ, peak = areas.get("offpeak"), areas.get("typical"), areas.get("peak")
    shrink = round((off - peak) / off * 100, 1) if off and peak and off > 0 else None
    return {
        "offpeak_sqmi": off,
        "typical_sqmi": typ,
        "peak_sqmi": peak,
        "peak_shrink_pct": shrink,
    }


def _fetch_contour(
    token: str, lat: float, lon: float, minutes: int, profile: str, depart_at: str | None
) -> dict[str, Any]:
    url = ISO_URL.format(profile=profile, lon=lon, lat=lat)
    params: dict[str, Any] = {
        "contours_minutes": minutes,
        "polygons": "true",
        "access_token": token,
    }
    if depart_at:
        params["depart_at"] = depart_at
    resp = httpx.get(url, params=params, timeout=15.0)
    resp.raise_for_status()
    return resp.json()


def fetch_mode_contour(
    token: str, lat: float, lon: float, minutes: int, mode: str, daily_budget: int = 0
) -> dict[str, Any]:
    """Single un-timed contour for walk/cycle (013 R2): durations are
    time-invariant, so there are no traffic scenarios and only one call."""
    lat, lon = snap_origin(lat, lon)
    key = (lon, lat, minutes, mode)
    hit = _CACHE.get(key)
    clock = time.time()
    if hit and hit[0] > clock:
        return hit[1]

    if not usage.reserve(1, daily_budget):
        raise usage.UsageBudgetError("daily upstream budget exhausted")

    logger.info("Fetching %s reach contour: %s min", mode, minutes)
    raw = _fetch_contour(token, lat, lon, minutes, MODE_PROFILES[mode], None)
    features = strip_mapbox_props(raw, minutes)
    if not features:
        raise httpx.HTTPError("empty isochrone response")
    label = MODE_LABELS.get(mode, mode)
    for feat in features[:1]:
        feat["properties"].update(
            {
                "scenario": "typical",
                "label": label,
                "area_sqmi": geodesic_area_sqmi(feat.get("geometry")),
            }
        )
    payload = build_collection(features[:1], lat=lat, lon=lon, minutes=minutes, variation=None)
    _CACHE[key] = (clock + CACHE_TTL_SECONDS, payload)
    return payload


def fetch_variation(
    token: str,
    lat: float,
    lon: float,
    minutes: int,
    now: datetime.datetime | None = None,
    daily_budget: int = 0,
) -> dict[str, Any]:
    """Build a time-of-day variation collection: the `minutes`-contour under each
    departure scenario (driving-traffic), with per-band area + a numeric summary.
    The origin is snapped to the cache grid first; cached by TTL. Scenarios that
    fail are skipped; raises only if ALL fail. Raises UsageBudgetError before
    any upstream call when the daily budget is exhausted (cache hits are free)."""
    lat, lon = snap_origin(lat, lon)
    key = (lon, lat, minutes, "drive")
    hit = _CACHE.get(key)
    clock = time.time()
    if hit and hit[0] > clock:
        return hit[1]

    if not usage.reserve(len(SCENARIOS), daily_budget):
        raise usage.UsageBudgetError("daily upstream budget exhausted")

    now = now or datetime.datetime.now(tzlookup.tz_for(lat, lon))
    logger.info("Fetching commute variation: %s min from work location", minutes)

    # Fetch the succeeding scenarios in outer->inner order.
    fetched: list[tuple[str, str, dict[str, Any]]] = []  # (scenario, label, feature)
    for scenario, hour, label in SCENARIOS:
        try:
            raw = _fetch_contour(
                token, lat, lon, minutes, "driving-traffic", next_departure(hour, now)
            )
        except httpx.HTTPError:
            logger.warning("Isochrone scenario %s failed", scenario)
            continue
        cleaned = strip_mapbox_props(raw, minutes)
        if cleaned:
            fetched.append((scenario, label, cleaned[0]))

    if not fetched:
        raise httpx.HTTPError("all isochrone scenarios failed")

    # Clip so the bands strictly nest, then recompute areas from clipped geometry.
    clipped = enforce_nesting([(scen, shape(feat["geometry"])) for scen, _, feat in fetched])
    features: list[dict[str, Any]] = []
    areas: dict[str, float] = {}
    for (scenario, label, feat), (_, geom) in zip(fetched, clipped, strict=True):
        geometry = mapping(geom)
        area = geodesic_area_sqmi(geometry)
        props = {**feat["properties"], "scenario": scenario, "label": label, "area_sqmi": area}
        features.append({"type": "Feature", "properties": props, "geometry": geometry})
        areas[scenario] = area

    payload = build_collection(
        features, lat=lat, lon=lon, minutes=minutes, variation=summarize_variation(areas)
    )
    _CACHE[key] = (clock + CACHE_TTL_SECONDS, payload)
    return payload


def cached_variation(
    lat: float, lon: float, minutes: int, mode: str = "drive"
) -> dict[str, Any] | None:
    """Return a cached (possibly stale) payload if one exists, else None."""
    lat, lon = snap_origin(lat, lon)
    hit = _CACHE.get((lon, lat, minutes, mode))
    return hit[1] if hit else None
