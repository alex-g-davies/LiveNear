"""Housing endpoints: the region index, per-ZIP enriched values (R1), and the
merged choropleth GeoJSON (R2), all scoped to a selectable state.

Responses are immutable until the committed data changes, so they carry a
strong per-state ETag + daily Cache-Control and honor If-None-Match (004 R4).
The choropleth is served from bytes pre-serialized at load time."""

from fastapi import APIRouter, HTTPException, Query, Request, Response

from ..data_loader import (
    DataLoadError,
    DataStore,
    get_data_store,
    load_regions,
    region_codes,
)
from ..models import HousingResponse, RegionInfo, ZipValue
from ..ratelimit import DATA_LIMIT, limiter

router = APIRouter(prefix="/api", tags=["housing"])

DEFAULT_STATE = "WA"
# no-cache = store but REVALIDATE every load. With strong ETags the
# revalidation is a cheap 304, and data updates (new metrics, refreshed
# values) reach returning browsers immediately instead of after a 24h
# max-age window — which made newly shipped $/sqft and affordability data
# look "blank" to anyone with a warm cache.
CACHE_CONTROL = "no-cache"


def _store_for(state: str) -> DataStore:
    code = (state or DEFAULT_STATE).upper()
    if code not in region_codes():
        raise HTTPException(status_code=404, detail=f"unknown state {code!r}")
    try:
        return get_data_store(code)
    except DataLoadError:
        raise HTTPException(
            status_code=503, detail=f"housing data temporarily unavailable for {code}"
        ) from None


def _not_modified(request: Request, etag: str) -> bool:
    return request.headers.get("if-none-match") == etag


@router.get("/regions", response_model=list[RegionInfo])
@limiter.limit(DATA_LIMIT)
def get_regions(request: Request, response: Response) -> list[RegionInfo]:
    """States available to select, with bounds/center for the picker + map fit."""
    response.headers["Cache-Control"] = CACHE_CONTROL
    return [RegionInfo(**r) for r in load_regions()]


@router.get("/housing", response_model=HousingResponse)
@limiter.limit(DATA_LIMIT)
def get_housing(
    request: Request, response: Response, state: str = Query(DEFAULT_STATE)
) -> HousingResponse | Response:
    """Per-ZIP enriched metrics for a state (R1/002). Invalid ZIPs are absent."""
    store = _store_for(state)
    etag = store.etag.rstrip('"') + '-h"'  # distinct from the geojson validator
    if _not_modified(request, etag):
        return Response(status_code=304)
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = CACHE_CONTROL
    zips = [
        ZipValue(
            zip=r.zip,
            median_value=r.median_value,
            yoy_pct=r.yoy_pct,
            cagr5_pct=r.cagr5_pct,
            ppsf=r.ppsf,
            history=r.history,
            population=r.population,
            median_income=r.median_income,
            price_to_income=r.price_to_income,
            name=r.name,
            price_per_m2=r.price_per_m2,
            sales=r.sales,
            area_type=r.area_type,
            income_level=r.income_level,
        )
        for _, r in sorted(store.housing.records.items())
    ]
    currency = "NOK" if store.housing.country == "NO" else "USD"
    return HousingResponse(
        metro=store.housing.metro, currency=currency, as_of=store.housing.as_of, zips=zips
    )


@router.get("/zips.geojson")
@limiter.limit(DATA_LIMIT)
def get_zips_geojson(request: Request, state: str = Query(DEFAULT_STATE)) -> Response:
    """ZIP boundary FeatureCollection with scalar metrics merged in (R2)."""
    store = _store_for(state)
    if _not_modified(request, store.etag):
        return Response(status_code=304)
    return Response(
        content=store.geojson_bytes,
        media_type="application/json",
        headers={"ETag": store.etag, "Cache-Control": CACHE_CONTROL},
    )
