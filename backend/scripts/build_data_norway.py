#!/usr/bin/env python
"""Build the committed Norwegian map data (spec 026 R1-R6).

Sources and their terms are logged in docs/livenear/sources.md. Prices are SSB
table 14545 per kommune and Oslo BOL018 per delbydel, income is SSB 06944, and
boundaries are Geonorge kommuner and grunnkretser. SSB's KLASS code list 460
says which grunnkretser make up each Oslo delbydel.

The US pipeline (build_data.py) is untouched: output goes to data/norway/.
Oslo's delbydeler are a separate output so they can be removed alone (R4).

    python scripts/build_data_norway.py --raw-dir <empty scratch folder>
"""

from __future__ import annotations

import argparse
import io
import json
import zipfile
from collections import defaultdict
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
import numpy as np
import shapely
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

BACKEND_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = BACKEND_DIR / "data" / "norway"

SSB_TABLE = "https://data.ssb.no/api/v0/en/table/{}"
OSLO_BOL018 = (
    "https://statistikkbanken.oslo.kommune.no/statbank/api/v1/no/db1/"
    + quote("Boliger og byggevirksomhet/Boligpriser/")
    + "ok-bol018.px"
)
KLASS_DELBYDEL_VERSION = "https://data.ssb.no/api/klass/v1/versions/1307"
GEONORGE_ORDER = "https://nedlasting.geonorge.no/api/order"
GEONORGE_LAYERS = {
    "kommuner": "041f1e6e-bdbc-4091-b48f-8a5990f3cc5b",
    "grunnkretser": "51d279f8-e2be-4f5e-9f72-1a53f7535ec1",
}
HEADERS = {"User-Agent": "LiveNear-data-build", "Accept": "application/json"}

PRICE_YEAR = "2025"  # R11: m² definitions differ before 2025, so one year only
INCOME_YEAR = "2024"
AS_OF = "2025-12-31"
MIN_SALES = 10  # R3
REFERENCE_M2 = 75  # R9 default, an estimate; the UI lets the user change it
OSLO_KOMMUNE = "0301"
AKERSHUS_FYLKE = "32"
COMBINED_REGION = "NO03"  # Oslo's fylke code, covering Oslo and Akershus (R2)

# Rush windows and the rest of the descriptor the frontend and backend read (R7).
# The windows are estimates of typical Norwegian commuting hours.
REGION_DESCRIPTOR = {
    "country": "NO",
    "currency": "NOK",
    "timezone": "Europe/Oslo",
    "units": "metric",
    "region_label": "Fylke",
    "area_label": "Kommune",
    "metrics": ["value", "ppsf", "afford"],
    "reference_m2": REFERENCE_M2,
    "rush": {
        "am": [[7, 0], [7, 45], [8, 30]],
        "pm": [[15, 0], [15, 30], [16, 15]],
        "peak_hour": 15,
    },
}

# EPSG:25833 (ETRS89 / UTM 33N, GRS80 ellipsoid). ETRS89 and WGS84 agree to
# well under the 10 m this data is rounded to.
_FLATTENING = 1 / 298.257222101
_N = _FLATTENING / (2 - _FLATTENING)
_RECTIFYING_RADIUS = 6378137.0 / (1 + _N) * (1 + _N**2 / 4 + _N**4 / 64)
_K0 = 0.9996
_FALSE_EASTING = 500_000.0
_CENTRAL_MERIDIAN = np.radians(15.0)
_BETA = (
    _N / 2 - 2 * _N**2 / 3 + 37 * _N**3 / 96,
    _N**2 / 48 + _N**3 / 15,
    17 * _N**3 / 480,
)
_DELTA = (
    2 * _N - 2 * _N**2 / 3 - 2 * _N**3,
    7 * _N**2 / 3 - 8 * _N**3 / 5,
    56 * _N**3 / 15,
)


# ---------------------------------------------------------------- pure helpers
def jsonstat_cells(doc: dict[str, Any]) -> Iterator[tuple[dict[str, str], Any]]:
    """Yield ({dimension: category code}, value) for a json-stat2 dataset."""
    ids: list[str] = doc["id"]
    sizes: list[int] = doc["size"]
    orders = []
    for dim in ids:
        index = doc["dimension"][dim]["category"]["index"]
        orders.append(sorted(index, key=index.get) if isinstance(index, dict) else list(index))
    values = doc["value"]
    getter = values.get if isinstance(values, dict) else None
    total = 1
    for s in sizes:
        total *= s
    for pos in range(total):
        coords: dict[str, str] = {}
        rem = pos
        for dim, order, size in zip(reversed(ids), reversed(orders), reversed(sizes), strict=True):
            rem, i = divmod(rem, size)
            coords[dim] = order[i]
        value = getter(str(pos)) if getter else values[pos]
        yield coords, value


def category_labels(doc: dict[str, Any], dim: str) -> dict[str, str]:
    """{category code: label} for one dimension."""
    return dict(doc["dimension"][dim]["category"]["label"])


def priced_row(price: Any, sales: Any) -> tuple[int, int] | None:
    """(price per m², sales) when publishable under R3, else None. A blank
    price, or fewer than MIN_SALES sales, is no value and is never imputed."""
    if price is None or sales is None or price <= 0 or sales < MIN_SALES:
        return None
    return round(price), int(sales)


def is_kommune_code(code: str) -> bool:
    return len(code) == 4 and code.isdigit()


def region_code_for_kommune(kommune: str) -> str:
    """Region a kommune belongs to: its fylke, with Oslo and Akershus combined."""
    fylke = kommune[:2]
    return COMBINED_REGION if fylke in ("03", AKERSHUS_FYLKE) else f"NO{fylke}"


def delbydel_area_id(klass_code: str) -> str:
    """8-digit area ID for a KLASS delbydel code, e.g. '0102' -> '03010102'."""
    return OSLO_KOMMUNE + klass_code.zfill(4)


def bydel_income_code(klass_code: str) -> str:
    """SSB 06944's bydel code holding a delbydel, e.g. '0102' -> '030101a'."""
    return f"{OSLO_KOMMUNE}{klass_code.zfill(4)[:2]}a"


def oslo_label_to_klass(label: str) -> str | None:
    """Oslo bank delbydel label -> KLASS code. Delbydel labels are 3-4 digits
    (bydel + 2 digits); shorter are bydeler, longer are grunnkretsområder."""
    return label.zfill(4) if len(label) in (3, 4) and label.isdigit() else None


def build_record(
    area_id: str,
    name: str,
    area_type: str,
    price: int,
    sales: int,
    income: int | None,
    income_level: str | None,
) -> dict[str, Any]:
    """One area's record. `median_value` is the estimated price at the default
    reference size so a record always has one; the frontend recomputes it from
    `price_per_m2` when the user changes the size (R9)."""
    estimate = price * REFERENCE_M2
    record: dict[str, Any] = {
        "zip": area_id,
        "name": name,
        "area_type": area_type,
        "median_value": estimate,
        "price_per_m2": price,
        "sales": sales,
    }
    if income:
        record["median_income"] = income
        record["income_level"] = income_level
        record["price_to_income"] = round(estimate / income, 1)
    return record


def drop_small_parts(geom: BaseGeometry, min_area_m2: float) -> BaseGeometry:
    """Remove islets under the threshold, always keeping the largest part."""
    if not isinstance(geom, MultiPolygon):
        return geom
    parts = sorted(geom.geoms, key=lambda p: p.area, reverse=True)
    kept = [p for i, p in enumerate(parts) if i == 0 or p.area >= min_area_m2]
    return kept[0] if len(kept) == 1 else MultiPolygon(kept)


def utm33_to_lonlat(coords: np.ndarray) -> np.ndarray:
    """EPSG:25833 [[easting, northing], ...] -> [[lon, lat], ...] in degrees,
    by the inverse Krüger series."""
    xi = coords[:, 1] / (_K0 * _RECTIFYING_RADIUS)
    eta = (coords[:, 0] - _FALSE_EASTING) / (_K0 * _RECTIFYING_RADIUS)
    xi_p, eta_p = xi.copy(), eta.copy()
    for j, beta in enumerate(_BETA, start=1):
        xi_p -= beta * np.sin(2 * j * xi) * np.cosh(2 * j * eta)
        eta_p -= beta * np.cos(2 * j * xi) * np.sinh(2 * j * eta)
    chi = np.arcsin(np.sin(xi_p) / np.cosh(eta_p))
    lat = chi.copy()
    for j, delta in enumerate(_DELTA, start=1):
        lat += delta * np.sin(2 * j * chi)
    lon = _CENTRAL_MERIDIAN + np.arctan2(np.sinh(eta_p), np.cos(xi_p))
    return np.degrees(np.column_stack([lon, lat]))


def to_wgs84(geom: BaseGeometry) -> BaseGeometry:
    """EPSG:25833 metres -> WGS84 lon/lat."""
    return shapely.transform(geom, utm33_to_lonlat)


def prepare_geometry(geom: BaseGeometry, tolerance_m: float, min_area_m2: float) -> BaseGeometry:
    """Simplify in metres, reproject, and round to about 10 m."""
    trimmed = drop_small_parts(geom, min_area_m2)
    simplified = trimmed.simplify(tolerance_m, preserve_topology=True)
    rounded = shapely.set_precision(to_wgs84(simplified), 0.0001)
    if rounded.geom_type == "GeometryCollection":
        polys = [g for g in rounded.geoms if isinstance(g, Polygon | MultiPolygon)]
        rounded = unary_union(polys)
    return rounded


def feature(area_id: str, name: str, geom: BaseGeometry) -> dict[str, Any]:
    return {
        "type": "Feature",
        "properties": {"zip": area_id, "name": name},
        "geometry": mapping(geom),
    }


def fc(features: Iterable[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "FeatureCollection", "features": list(features)}


def bounds_and_center(
    geoms: list[BaseGeometry], busiest: BaseGeometry | None
) -> tuple[list[float], list[float]]:
    """Region bbox, plus a default pin in its busiest housing market (R2)."""
    union = unary_union(geoms)
    bbox = [round(v, 4) for v in union.bounds]
    point = (busiest or union).representative_point()
    return bbox, [round(point.x, 4), round(point.y, 4)]


# -------------------------------------------------------------------- fetching
def _post_jsonstat(url: str, query: list[dict[str, Any]]) -> dict[str, Any]:
    body = {"query": query, "response": {"format": "json-stat2"}}
    r = httpx.post(url, json=body, headers=HEADERS, timeout=120)
    r.raise_for_status()
    return json.loads(r.content.decode("utf-8-sig"))


def _item(code: str, *values: str) -> dict[str, Any]:
    return {"code": code, "selection": {"filter": "item", "values": list(values)}}


def _every(code: str) -> dict[str, Any]:
    return {"code": code, "selection": {"filter": "all", "values": ["*"]}}


def fetch_ssb_prices() -> tuple[dict[str, tuple[int, int]], dict[str, str]]:
    """({kommune: (NOK/m², sales)}, {fylke code: name}) from table 14545."""
    doc = _post_jsonstat(
        SSB_TABLE.format("14545"),
        [_every("Region"), _item("Boligtype", "00"), _item("Tid", PRICE_YEAR)],
    )
    by_region: dict[str, dict[str, Any]] = defaultdict(dict)
    for coords, value in jsonstat_cells(doc):
        by_region[coords["Region"]][coords["ContentsCode"]] = value
    prices = {}
    for code, cells in by_region.items():
        row = priced_row(cells.get("KvPris"), cells.get("Omsetninger"))
        if is_kommune_code(code) and row:
            prices[code] = row
    labels = category_labels(doc, "Region")
    fylker = {c: n.split(" - ")[0].strip() for c, n in labels.items() if len(c) == 2}
    return prices, fylker


def fetch_income() -> dict[str, int]:
    """{region code: median household income after tax}, kommuner and bydeler."""
    doc = _post_jsonstat(
        SSB_TABLE.format("06944"),
        [
            _every("Region"),
            _item("HusholdType", "0000"),
            _item("ContentsCode", "InntSkatt"),
            _item("Tid", INCOME_YEAR),
        ],
    )
    return {c["Region"]: int(v) for c, v in jsonstat_cells(doc) if v}


def fetch_oslo_prices() -> dict[str, tuple[int, int]]:
    """{KLASS delbydel code: (NOK/m², sales)} from Oslo BOL018, latest year."""
    r = httpx.get(OSLO_BOL018, headers=HEADERS, timeout=60)
    r.raise_for_status()
    meta = json.loads(r.content.decode("utf-8-sig"))
    variables = {v["code"]: v for v in meta["variables"]}
    year_var = next(v for v in meta["variables"] if v["text"].lower().startswith(("år", "ar")))
    if year_var["valueTexts"][-1] != PRICE_YEAR:
        raise SystemExit(f"BOL018 latest year is {year_var['valueTexts'][-1]}, not {PRICE_YEAR}")
    stat = variables["statistikkvariabel"]
    sales_code = stat["values"][stat["valueTexts"].index("Antall salg")]
    price_code = stat["values"][stat["valueTexts"].index("Gjennomsnitt kvadratmeterpris")]
    housing = variables["boligtype"]
    doc = _post_jsonstat(
        OSLO_BOL018,
        [
            _every("geografi"),
            _item(year_var["code"], year_var["values"][-1]),
            _item("boligtype", housing["values"][housing["valueTexts"].index("Boliger i alt")]),
            _item("statistikkvariabel", sales_code, price_code),
        ],
    )
    labels = category_labels(doc, "geografi")
    cells: dict[str, dict[str, Any]] = defaultdict(dict)
    for coords, value in jsonstat_cells(doc):
        cells[coords["geografi"]][coords["statistikkvariabel"]] = value
    out = {}
    for code, row in cells.items():
        klass = oslo_label_to_klass(labels[code])
        priced = priced_row(row.get(price_code), row.get(sales_code))
        if klass and priced:
            out[klass] = priced
    return out


def fetch_delbydel_structure() -> tuple[dict[str, str], dict[str, list[str]]]:
    """({KLASS code: name}, {KLASS code: [grunnkrets codes]}) from KLASS 460."""
    version = httpx.get(
        KLASS_DELBYDEL_VERSION, params={"language": "nb"}, headers=HEADERS, timeout=60
    ).json()
    names = {i["code"]: i["name"] for i in version["classificationItems"]}
    latest = max(version["correspondenceTables"], key=lambda c: c["name"])
    table = httpx.get(
        latest["_links"]["self"]["href"], params={"language": "nb"}, headers=HEADERS, timeout=120
    ).json()
    members: dict[str, list[str]] = defaultdict(list)
    for row in table["correspondenceMaps"]:
        members[row["sourceCode"]].append(row["targetCode"])
    return names, dict(members)


def ensure_boundaries(raw_dir: Path, layer: str) -> Path:
    """Path to a Geonorge layer's GeoJSON, downloading it once into raw_dir."""
    dest = raw_dir / layer
    if not dest.exists():
        order = {
            "email": "",
            "orderLines": [
                {
                    "metadataUuid": GEONORGE_LAYERS[layer],
                    "areas": [{"code": "0000", "type": "landsdekkende", "name": "Hele landet"}],
                    "projections": [{"code": "25833"}],
                    "formats": [{"name": "GeoJSON"}],
                }
            ],
        }
        files = httpx.post(GEONORGE_ORDER, json=order, timeout=180).json()["files"]
        r = httpx.get(files[0]["downloadUrl"], timeout=900, follow_redirects=True)
        r.raise_for_status()
        dest.mkdir(parents=True)
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            z.extractall(dest)
    pattern = "*Grunnkrets_GeoJSON*" if layer == "grunnkretser" else "*.geojson"
    return next(dest.glob(pattern))


def read_polygons(path: Path, objtype: str) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    return [f for f in data["features"] if f["properties"].get("objtype") == objtype]


# ---------------------------------------------------------------------- output
def dump(path: Path, payload: Any) -> int:
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    path.write_text(text, encoding="utf-8", newline="\n")
    return len(text.encode("utf-8"))


def build_oslo_overlay(
    raw_dir: Path,
    income: dict[str, int],
    out_dir: Path,
    tolerance_m: float,
) -> tuple[list[BaseGeometry], int]:
    """Write the separable delbydel output (R4). Returns geometries and size."""
    names, members = fetch_delbydel_structure()
    prices = fetch_oslo_prices()
    kretser = {
        f["properties"]["grunnkretsnummer"]: shape(f["geometry"])
        for f in read_polygons(ensure_boundaries(raw_dir, "grunnkretser"), "Grunnkrets")
        if f["properties"]["grunnkretsnummer"].startswith(OSLO_KOMMUNE)
    }
    missing = sorted(k for codes in members.values() for k in codes if k not in kretser)
    if missing:
        raise SystemExit(f"{len(missing)} grunnkretser have no boundary, e.g. {missing[:3]}")

    features, geoms, records = [], [], []
    for code, name in sorted(names.items()):
        merged = unary_union([kretser[k] for k in members[code]])
        geom = prepare_geometry(merged, tolerance_m, 5_000)
        area_id = delbydel_area_id(code)
        features.append(feature(area_id, name, geom))
        geoms.append(geom)
        row = prices.get(code)
        if row:
            records.append(
                build_record(
                    area_id,
                    name,
                    "Delbydel",
                    row[0],
                    row[1],
                    income.get(bydel_income_code(code)),
                    "bydel",
                )
            )
    size = dump(out_dir / "oslo_delbydeler.geojson", fc(features))
    size += dump(out_dir / "oslo_delbydeler.values.json", {"zips": records})
    print(f"Oslo: {len(features)} delbydeler, {len(records)} priced")
    return geoms, size


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--raw-dir", required=True, help="Cache for downloaded boundaries")
    ap.add_argument("--out-dir", default=str(OUT_DIR))
    ap.add_argument("--tolerance", type=float, default=60.0, help="Kommune simplify, metres")
    ap.add_argument("--oslo-tolerance", type=float, default=10.0, help="Delbydel simplify, metres")
    ap.add_argument("--no-oslo", action="store_true", help="Skip delbydeler (R4)")
    args = ap.parse_args()
    raw_dir, out_dir = Path(args.raw_dir), Path(args.out_dir)
    raw_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)

    prices, fylker = fetch_ssb_prices()
    income = fetch_income()
    print(f"SSB: {len(prices)} kommuner priced; income for {len(income)} regions")

    grouped: dict[str, list[tuple[str, str, BaseGeometry, tuple[int, int] | None]]]
    grouped = defaultdict(list)
    for f in read_polygons(ensure_boundaries(raw_dir, "kommuner"), "Kommune"):
        code = f["properties"]["kommunenummer"].zfill(4)
        name = f["properties"]["kommunenavn"]
        geom = prepare_geometry(shape(f["geometry"]), args.tolerance, 200_000)
        grouped[region_code_for_kommune(code)].append((code, name, geom, prices.get(code)))

    total = 0
    oslo_geoms: list[BaseGeometry] = []
    if args.no_oslo:
        for stale in out_dir.glob("oslo_delbydeler.*"):
            stale.unlink()
    else:
        oslo_geoms, size = build_oslo_overlay(raw_dir, income, out_dir, args.oslo_tolerance)
        total += size

    regions = []
    for code, rows in sorted(grouped.items()):
        records = []
        for kommune, name, _, row in rows:
            if row:
                records.append(
                    build_record(
                        kommune, name, "Kommune", row[0], row[1], income.get(kommune), "kommune"
                    )
                )
        features = [feature(k, n, g) for k, n, g, _ in rows]
        name = "Oslo & Akershus" if code == COMBINED_REGION else fylker[code[2:]]
        payload = {"state": code, "name": name, "country": "NO", "as_of": AS_OF, "zips": records}
        total += dump(out_dir / f"{code}.geojson", fc(features))
        total += dump(out_dir / f"{code}.values.json", payload)
        priced = [r for r in rows if r[3]]
        busiest = max(priced, key=lambda r: r[3][1])[2] if priced else None
        bbox, center = bounds_and_center([r[2] for r in rows], busiest)
        count = len(rows)
        if code == COMBINED_REGION and oslo_geoms:
            count += len(oslo_geoms) - 1
        regions.append(
            {
                "code": code,
                "name": name,
                "bbox": bbox,
                "center": center,
                "zip_count": count,
                **REGION_DESCRIPTOR,
            }
        )
    total += dump(out_dir / "regions.json", sorted(regions, key=lambda r: r["name"]))
    print(f"Regions: {len(regions)}; committed size {total / 1_000_000:.2f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
