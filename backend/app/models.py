"""Pydantic response models. Note: no model carries the Mapbox token (R5)."""

from pydantic import BaseModel


class ZipValue(BaseModel):
    zip: str
    median_value: int
    # Enriched metrics (spec 002). Optional — omitted when unavailable.
    yoy_pct: float | None = None
    cagr5_pct: float | None = None
    ppsf: float | None = None
    history: list[tuple[str, int]] | None = None
    # Census ACS context (spec 008). Optional — omitted when unavailable.
    population: int | None = None
    median_income: int | None = None
    price_to_income: float | None = None
    # GeoNames primary place name (spec 012). Optional.
    name: str | None = None
    # Norway (spec 026): published average price, sales behind it, the kind of
    # area, and the level the income figure describes.
    price_per_m2: int | None = None
    sales: int | None = None
    area_type: str | None = None
    income_level: str | None = None


class HousingResponse(BaseModel):
    metro: str
    currency: str = "USD"
    as_of: str
    zips: list[ZipValue]


class GeocodeResult(BaseModel):
    lat: float
    lon: float
    place_name: str


class CommuteEstimate(BaseModel):
    """Routed commute estimates for a (home, work) pair (spec 013 R1/R2).

    Drive mode: min–max minutes across rush-window departure samples per
    direction, with the window's origin-local naive timestamps. Walk/cycle:
    min == max and null windows (durations are time-invariant)."""

    mode: str
    am_min_minutes: int
    am_max_minutes: int
    am_window_start_local: str | None = None
    am_window_end_local: str | None = None
    pm_min_minutes: int
    pm_max_minutes: int
    pm_window_start_local: str | None = None
    pm_window_end_local: str | None = None


class RegionInfo(BaseModel):
    """A selectable region: name, map bounds and center, plus how to present it
    (026 R7). Fields absent from the data file take the US defaults below."""

    code: str
    name: str
    bbox: list[float] | None = None  # [minLon, minLat, maxLon, maxLat]
    center: list[float] | None = None  # [lon, lat]
    zip_count: int
    country: str = "US"
    currency: str = "USD"
    timezone: str | None = None
    units: str = "imperial"
    region_label: str = "State"
    area_label: str = "ZIP"
    metrics: list[str] | None = None  # None = every metric
    reference_m2: int | None = None
