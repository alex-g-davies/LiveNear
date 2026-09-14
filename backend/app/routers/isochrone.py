"""Commute isochrone endpoint (R3/003) and the Mapbox token-safety boundary (R5).

The client may pass lat/lon/minutes; the token-bearing Mapbox call (and the
depart_at timing for the traffic scenarios) stays entirely server-side."""

import json
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from ..config import DATA_DIR, Settings, get_settings
from ..data_loader import within_coverage
from ..isochrone import (
    MODE_PROFILES,
    build_collection,
    cached_variation,
    fetch_mode_contour,
    fetch_variation,
    geodesic_area_sqmi,
    strip_mapbox_props,
)
from ..ratelimit import UPSTREAM_LIMIT, limiter
from ..usage import UsageBudgetError

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["isochrone"])

FIXTURE_FILE = "isochrone_fixture.json"
ALLOWED_MINUTES = (15, 30, 45, 60)  # Mapbox isochrones cap at 60 min/contour


def _load_fixture(settings: Settings, lat: float, lon: float, minutes: int) -> dict:
    """Serve the committed fixture as a single 'typical' band (no traffic
    variation) so the overlay renders without a Mapbox token (fixture-first)."""
    with open(DATA_DIR / FIXTURE_FILE, encoding="utf-8") as f:
        raw = json.load(f)
    features = strip_mapbox_props(raw, minutes)
    for feat in features:
        feat["properties"].update(
            {
                "scenario": "typical",
                "label": "Typical",
                "area_sqmi": geodesic_area_sqmi(feat.get("geometry")),
            }
        )
    return build_collection(features, lat=lat, lon=lon, minutes=minutes, variation=None)


@router.get("/isochrone")
@limiter.limit(UPSTREAM_LIMIT)
def get_isochrone(
    request: Request,
    lat: float | None = Query(None, ge=-90, le=90, description="Work latitude"),
    lon: float | None = Query(None, ge=-180, le=180, description="Work longitude"),
    minutes: int | None = Query(None, description="Commute minutes (15/30/45/60)"),
    mode: str = Query("drive", description="Travel mode: drive / walk / cycle"),
    settings: Settings = Depends(get_settings),
) -> JSONResponse:
    """Reach from the work location: traffic variation bands for drive, a single
    contour for walk/cycle (013 R2). The token never leaves the backend (R5)."""
    work_lat = lat if lat is not None else settings.work_lat
    work_lon = lon if lon is not None else settings.work_lon
    mins = minutes if minutes is not None else settings.contour_minutes
    if mins not in ALLOWED_MINUTES:
        raise HTTPException(status_code=422, detail=f"minutes must be one of {ALLOWED_MINUTES}")
    if mode not in MODE_PROFILES:
        raise HTTPException(status_code=422, detail=f"mode must be one of {tuple(MODE_PROFILES)}")
    if not within_coverage(work_lat, work_lon):
        raise HTTPException(status_code=422, detail="work location is outside the covered regions")

    if settings.serve_fixture:
        return JSONResponse(content=_load_fixture(settings, work_lat, work_lon, mins))
    if not settings.mapbox_token.strip():
        # Production with no token (021 R1): fail loudly rather than serve a
        # static polygon that masquerades as a live contour for every pin. The
        # frontend's "Commute layer unavailable" toast covers the 503.
        raise HTTPException(status_code=503, detail="isochrone unavailable (no token configured)")

    try:
        if mode == "drive":
            payload = fetch_variation(
                settings.mapbox_token,
                work_lat,
                work_lon,
                mins,
                daily_budget=settings.mapbox_daily_call_budget,
            )
        else:
            payload = fetch_mode_contour(
                settings.mapbox_token,
                work_lat,
                work_lon,
                mins,
                mode,
                daily_budget=settings.mapbox_daily_call_budget,
            )
        return JSONResponse(content=payload)
    except (httpx.HTTPError, UsageBudgetError) as exc:
        # Never leak the token (which lives in the request URL) into the error.
        if isinstance(exc, UsageBudgetError):
            logger.warning("Isochrone skipped: daily upstream budget exhausted")
        else:
            logger.warning("Isochrone upstream call failed", exc_info=False)
        stale = cached_variation(work_lat, work_lon, mins, mode)
        if stale is not None:
            return JSONResponse(content=stale)
        raise HTTPException(status_code=503, detail="isochrone upstream unavailable") from None
