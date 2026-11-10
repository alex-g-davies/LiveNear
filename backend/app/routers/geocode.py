"""Address search endpoint (forward geocoding). The Mapbox token stays
server-side (R5); the client sends only a free-text query plus an optional
proximity bias — the selected region's center (spec 010 R3)."""

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ..config import Settings, get_settings
from ..data_loader import within_coverage
from ..geocode import forward_geocode, reverse_geocode
from ..models import GeocodeResult
from ..ratelimit import UPSTREAM_LIMIT, limiter
from ..usage import UsageBudgetError

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["geocode"])


@router.get("/geocode", response_model=GeocodeResult)
@limiter.limit(UPSTREAM_LIMIT)
def geocode(
    request: Request,
    q: str = Query(..., min_length=1, description="Address or place to find"),
    proximity_lat: float | None = Query(None, ge=-90, le=90, description="Bias latitude"),
    proximity_lon: float | None = Query(None, ge=-180, le=180, description="Bias longitude"),
    settings: Settings = Depends(get_settings),
) -> GeocodeResult:
    if not settings.mapbox_token.strip():
        raise HTTPException(status_code=503, detail="geocoding unavailable (no token configured)")
    # Bias only when the client supplies a full point (both-or-none semantics).
    has_proximity = proximity_lat is not None and proximity_lon is not None
    try:
        result = forward_geocode(
            settings.mapbox_token,
            q,
            proximity_lon=proximity_lon if has_proximity else None,
            proximity_lat=proximity_lat if has_proximity else None,
            daily_budget=settings.mapbox_daily_call_budget,
        )
    except UsageBudgetError:
        logger.warning("Geocoding skipped: daily upstream budget exhausted")
        raise HTTPException(status_code=503, detail="geocoding temporarily unavailable") from None
    except httpx.HTTPError:
        logger.warning("Geocoding upstream call failed")
        raise HTTPException(status_code=503, detail="geocoding upstream unavailable") from None

    # Norway has places outside any covered region, such as Svalbard (026 R12).
    if result is None or not within_coverage(result["lat"], result["lon"]):
        raise HTTPException(status_code=404, detail=f"no match for {q!r}")
    return GeocodeResult(**result)


@router.get("/geocode/reverse", response_model=GeocodeResult)
@limiter.limit(UPSTREAM_LIMIT)
def geocode_reverse(
    request: Request,
    lat: float = Query(..., ge=-90, le=90, description="Pin latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Pin longitude"),
    settings: Settings = Depends(get_settings),
) -> GeocodeResult:
    """Nearest address for a work pin (015 R1). Geofenced to covered regions
    so this never becomes a free worldwide reverse geocoder."""
    if not settings.mapbox_token.strip():
        raise HTTPException(status_code=503, detail="geocoding unavailable (no token configured)")
    if not within_coverage(lat, lon):
        raise HTTPException(status_code=422, detail="location outside the covered regions")
    try:
        result = reverse_geocode(
            settings.mapbox_token, lat, lon, daily_budget=settings.mapbox_daily_call_budget
        )
    except UsageBudgetError:
        logger.warning("Reverse geocoding skipped: daily upstream budget exhausted")
        raise HTTPException(status_code=503, detail="geocoding temporarily unavailable") from None
    except httpx.HTTPError:
        logger.warning("Reverse geocoding upstream call failed")
        raise HTTPException(status_code=503, detail="geocoding upstream unavailable") from None

    if result is None:
        raise HTTPException(status_code=404, detail="no address near this point")
    return GeocodeResult(**result)
