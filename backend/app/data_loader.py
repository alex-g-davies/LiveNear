"""Load and validate the committed housing + geometry datasets.

The parsing functions are pure so they can be unit-tested without the app (R1):
invalid/missing ZIPs are skipped, never fatal. The join key is a 5-character
zero-padded string on both the ZHVI and ZCTA sides.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from .config import DATA_DIR

logger = logging.getLogger(__name__)

STATES_DIR = DATA_DIR / "states"
REGIONS_FILE = DATA_DIR / "regions.json"


# Region -> (overlay file stem, the area it replaces): finer areas kept as a
# separate output, so removing the files restores the one polygon (026 R4).
OVERLAYS = {"NO03": ("oslo_delbydeler", "0301")}


def _norway_dir() -> Path:
    # Beside the regions file, so a test's temporary data has no Norway in it.
    return REGIONS_FILE.parent / "norway"


class DataLoadError(Exception):
    """A state's committed data files are missing or corrupt (spec 004 R7).

    Routers translate this into a 503 for that state only — never a 500
    traceback; other states keep working."""


def normalize_zip(raw: Any) -> str | None:
    """Coerce a raw ZIP (int like 98101 or str like '98101') to a 5-char string.

    Returns None when it can't be made into exactly 5 digits — the top failure
    mode is silent leading-zero loss when ZIPs are stored as integers.
    """
    if raw is None:
        return None
    if isinstance(raw, float):
        if raw != raw or raw < 0:  # NaN or negative
            return None
        raw = int(raw)
    if isinstance(raw, int):
        if raw < 0:
            return None
        raw = str(raw)
    if not isinstance(raw, str):
        return None
    s = raw.strip()
    if not s.isdigit() or len(s) > 5:
        return None
    s = s.zfill(5)
    return s if len(s) == 5 else None


def normalize_area_id(raw: Any) -> str | None:
    """A non-US area key (026 R8): an opaque digit string, kept exactly.

    Numbers are refused, because a 4-digit kommune code such as 0301 cannot
    survive being stored as one."""
    if not isinstance(raw, str):
        return None
    s = raw.strip()
    return s if s.isdigit() and 4 <= len(s) <= 8 else None


def _area_id_normalizer(country: str):
    return normalize_zip if country == "US" else normalize_area_id


def _coerce_value(raw: Any) -> int | None:
    """Return a positive int median value, or None for missing/invalid/<=0."""
    if raw is None or isinstance(raw, bool):
        return None
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return None
    if v != v or v <= 0:  # NaN or non-positive
        return None
    return int(round(v))


def _coerce_float(raw: Any) -> float | None:
    """Return a float metric (may be negative, e.g. YoY), or None if invalid."""
    if raw is None or isinstance(raw, bool):
        return None
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return None
    return None if v != v else v  # drop NaN


def _coerce_name(raw: Any) -> str | None:
    """A non-empty place-name string, else None (spec 012 R1)."""
    if not isinstance(raw, str):
        return None
    s = raw.strip()
    return s or None


def _coerce_history(raw: Any) -> list[tuple[str, int]] | None:
    """Validate a [[label, value], ...] series, dropping malformed points."""
    if not isinstance(raw, list):
        return None
    out: list[tuple[str, int]] = []
    for item in raw:
        if isinstance(item, list | tuple) and len(item) == 2:
            label, value = item
            v = _coerce_value(value)
            if isinstance(label, str) and v is not None:
                out.append((label, v))
    return out or None


@dataclass
class ZipRecord:
    """One ZIP's metrics. median_value is required; the rest are optional
    (002 enrichment, 008 ACS context)."""

    zip: str
    median_value: int
    yoy_pct: float | None = None
    cagr5_pct: float | None = None
    ppsf: float | None = None
    history: list[tuple[str, int]] | None = None
    population: int | None = None
    median_income: int | None = None
    price_to_income: float | None = None
    name: str | None = None  # GeoNames primary place name (012)
    # Norway (026): the published price, and what the area and income describe.
    price_per_m2: int | None = None
    sales: int | None = None
    area_type: str | None = None
    income_level: str | None = None


@dataclass
class ParsedHousing:
    metro: str
    as_of: str
    records: dict[str, ZipRecord] = field(default_factory=dict)  # zip -> record
    skipped: int = 0
    country: str = "US"


def parse_housing(raw: dict[str, Any]) -> ParsedHousing:
    """Validate a raw ZHVI JSON dict into a zip->record map, skipping bad rows.

    A row needs a valid ZIP and a positive median_value; the enriched metrics are
    coerced individually and left as None when missing/invalid (never fatal)."""
    metro = str(raw.get("metro") or raw.get("name") or "")  # state payloads use `name`
    as_of = str(raw.get("as_of", ""))
    country = str(raw.get("country") or "US")
    normalize = _area_id_normalizer(country)
    records: dict[str, ZipRecord] = {}
    skipped = 0
    for row in raw.get("zips", []) or []:
        if not isinstance(row, dict):
            skipped += 1
            continue
        z = normalize(row.get("zip"))
        v = _coerce_value(row.get("median_value"))
        if z is None or v is None:
            skipped += 1
            continue
        records[z] = ZipRecord(
            zip=z,
            median_value=v,
            yoy_pct=_coerce_float(row.get("yoy_pct")),
            cagr5_pct=_coerce_float(row.get("cagr5_pct")),
            ppsf=_coerce_float(row.get("ppsf")),
            history=_coerce_history(row.get("history")),
            population=_coerce_value(row.get("population")),
            median_income=_coerce_value(row.get("median_income")),
            price_to_income=_coerce_float(row.get("price_to_income")),
            name=_coerce_name(row.get("name")),
            price_per_m2=_coerce_value(row.get("price_per_m2")),
            sales=_coerce_value(row.get("sales")),
            area_type=_coerce_name(row.get("area_type")),
            income_level=_coerce_name(row.get("income_level")),
        )
    if skipped:
        logger.info("parse_housing: skipped %d invalid ZHVI row(s)", skipped)
    return ParsedHousing(
        metro=metro, as_of=as_of, records=records, skipped=skipped, country=country
    )


# Scalar metrics merged into the choropleth GeoJSON for data-driven shading.
# History is intentionally excluded — MapLibre stringifies nested feature
# properties, so the popup reads history from /api/housing instead.
GEOJSON_METRICS = ("median_value", "yoy_pct", "ppsf", "price_to_income", "price_per_m2")

# The served geojson bytes depend on GEOJSON_METRICS as well as the source
# files, so the ETag must change when this list does — otherwise browsers
# holding the old shape revalidate into 304s forever (spec 014 R2).
_ETAG_SCHEMA_SALT = ("metrics:" + ",".join(GEOJSON_METRICS)).encode("utf-8")


def merge_geojson(
    geojson_raw: dict[str, Any], records: dict[str, ZipRecord], country: str = "US"
) -> dict[str, Any]:
    """Return a FeatureCollection with normalized `zip` + merged scalar metrics.

    Features whose ZIP can't be normalized are dropped (skipped, not fatal). Each
    metric is set when present and omitted otherwise, so the frontend can guard
    with `['has', metric]` and render missing metrics as 'no data'.
    """
    normalize = _area_id_normalizer(country)
    features_out: list[dict[str, Any]] = []
    dropped = 0
    for feat in geojson_raw.get("features", []) or []:
        props = dict(feat.get("properties") or {})
        # Accept either a pre-set `zip` or the raw Census ZCTA property.
        z = normalize(props.get("zip") or props.get("ZCTA5CE20") or props.get("ZCTA5CE10"))
        if z is None:
            dropped += 1
            continue
        props["zip"] = z
        record = records.get(z)
        for metric in GEOJSON_METRICS:
            value = getattr(record, metric, None) if record else None
            if value is not None:
                props[metric] = value
            else:
                props.pop(metric, None)
        features_out.append({**feat, "properties": props})
    if dropped:
        logger.info("merge_geojson: dropped %d feature(s) with invalid ZIP", dropped)
    return {"type": "FeatureCollection", "features": features_out}


def _apply_overlay(
    values: dict[str, Any], geo: dict[str, Any], directory: Path, stem: str, replaced: str
) -> bytes:
    """Replace one area with its overlay's finer areas, in place. Returns the
    overlay's bytes for the ETag; a missing or corrupt overlay leaves the region
    as it is, because the rest of it still works (026 R4)."""
    try:
        overlay_values_bytes = (directory / f"{stem}.values.json").read_bytes()
        overlay_geo_bytes = (directory / f"{stem}.geojson").read_bytes()
        overlay_values = json.loads(overlay_values_bytes)
        overlay_geo = json.loads(overlay_geo_bytes)
    except FileNotFoundError:
        return b""
    except (OSError, ValueError) as exc:
        logger.error("Overlay %s unreadable, keeping area %s: %s", stem, replaced, exc)
        return b""
    kept = [z for z in values.get("zips", []) if z.get("zip") != replaced]
    values["zips"] = kept + overlay_values["zips"]
    geo["features"] = [
        f for f in geo.get("features", []) if (f.get("properties") or {}).get("zip") != replaced
    ] + overlay_geo["features"]
    return overlay_values_bytes + overlay_geo_bytes


@dataclass
class DataStore:
    housing: ParsedHousing
    geojson: dict[str, Any]
    # Pre-serialized choropleth + a version tag derived from the source files,
    # so /api/zips.geojson serves cached bytes with a strong ETag instead of
    # re-serializing multi-MB JSON per request (spec 004 R4).
    geojson_bytes: bytes = b""
    etag: str = ""

    @classmethod
    def load(cls, state: str, states_dir: Path = STATES_DIR) -> DataStore:
        """Load one state's committed housing values + choropleth geometry.

        Raises DataLoadError when either file is missing or unparseable."""
        try:
            zhvi_bytes = (states_dir / f"{state}.zhvi.json").read_bytes()
            geo_bytes = (states_dir / f"{state}.geojson").read_bytes()
            housing = parse_housing(json.loads(zhvi_bytes))
            geojson = merge_geojson(json.loads(geo_bytes), housing.records)
        except (OSError, ValueError) as exc:
            logger.error("DataStore[%s]: failed to load data files: %s", state, exc)
            raise DataLoadError(f"data unavailable for state {state!r}") from exc
        return cls._assemble(state, housing, geojson, zhvi_bytes + geo_bytes)

    @classmethod
    def load_norway(cls, state: str, directory: Path) -> DataStore:
        """Load a Norwegian region, swapping in its overlay when present (026 R4)."""
        try:
            values_bytes = (directory / f"{state}.values.json").read_bytes()
            geo_bytes = (directory / f"{state}.geojson").read_bytes()
            values, geo = json.loads(values_bytes), json.loads(geo_bytes)
        except (OSError, ValueError) as exc:
            logger.error("DataStore[%s]: failed to load data files: %s", state, exc)
            raise DataLoadError(f"data unavailable for state {state!r}") from exc
        version_bytes = values_bytes + geo_bytes
        overlay = OVERLAYS.get(state)
        if overlay:
            version_bytes += _apply_overlay(values, geo, directory, *overlay)
        housing = parse_housing(values)
        geojson = merge_geojson(geo, housing.records, housing.country)
        return cls._assemble(state, housing, geojson, version_bytes)

    @classmethod
    def _assemble(
        cls, state: str, housing: ParsedHousing, geojson: dict[str, Any], version_bytes: bytes
    ) -> DataStore:
        version = hashlib.sha256(version_bytes + _ETAG_SCHEMA_SALT).hexdigest()[:16]
        logger.info(
            "DataStore[%s]: %d ZIP records, %d geojson features",
            state,
            len(housing.records),
            len(geojson["features"]),
        )
        return cls(
            housing=housing,
            geojson=geojson,
            geojson_bytes=json.dumps(geojson, separators=(",", ":")).encode("utf-8"),
            etag=f'"{state}-{version}"',
        )


@lru_cache(maxsize=8)
def get_data_store(state: str) -> DataStore:
    """Per-state cached store (bounded — only requested states stay in memory)."""
    region = next((r for r in load_regions() if r["code"] == state), None)
    if region and region.get("country", "US") != "US":
        return DataStore.load_norway(state, _norway_dir())
    return DataStore.load(state, STATES_DIR)


@lru_cache
def load_regions() -> list[dict[str, Any]]:
    """The region index for the picker: US states, then Norwegian regions (026 R2)."""
    if not REGIONS_FILE.exists():
        return []
    regions = json.loads(REGIONS_FILE.read_text(encoding="utf-8"))
    norway = _norway_dir() / "regions.json"
    if norway.exists():
        regions += json.loads(norway.read_text(encoding="utf-8"))
    return regions


def region_codes() -> set[str]:
    return {r["code"] for r in load_regions()}


# Degrees of slack around each region bbox: generous enough that a work
# location just across a state line still resolves, tight enough to keep the
# isochrone proxy from being driven from arbitrary points on Earth (004 R2).
COVERAGE_BUFFER_DEG = 0.5


def within_coverage(lat: float, lon: float) -> bool:
    """True when (lat, lon) falls inside any loaded region's buffered bbox.

    With no region index (bare dev checkout), everything passes — the geofence
    exists to bound public Mapbox spend, not to gate local development."""
    regions = load_regions()
    if not regions:
        return True
    for r in regions:
        west, south, east, north = r["bbox"]
        if (
            south - COVERAGE_BUFFER_DEG <= lat <= north + COVERAGE_BUFFER_DEG
            and west - COVERAGE_BUFFER_DEG <= lon <= east + COVERAGE_BUFFER_DEG
        ):
            return True
    return False
