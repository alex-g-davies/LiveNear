"""Norway data build (spec 026 R1-R6): pure helpers, no network."""

import importlib.util
import sys
from pathlib import Path

import numpy as np
import pytest
from shapely.geometry import MultiPolygon, box

_PATH = Path(__file__).resolve().parent.parent / "scripts" / "build_data_norway.py"
_SPEC = importlib.util.spec_from_file_location("build_data_norway", _PATH)
assert _SPEC and _SPEC.loader
build = importlib.util.module_from_spec(_SPEC)
sys.modules["build_data_norway"] = build
_SPEC.loader.exec_module(build)


def test_jsonstat_cells_walks_dimensions_in_row_major_order():
    doc = {
        "id": ["Region", "ContentsCode"],
        "size": [2, 2],
        "dimension": {
            "Region": {"category": {"index": {"0301": 0, "3201": 1}}},
            "ContentsCode": {"category": {"index": {"KvPris": 0, "Omsetninger": 1}}},
        },
        "value": [100, 20, None, 3],
    }
    cells = {(c["Region"], c["ContentsCode"]): v for c, v in build.jsonstat_cells(doc)}
    assert cells[("0301", "KvPris")] == 100
    assert cells[("0301", "Omsetninger")] == 20
    assert cells[("3201", "KvPris")] is None
    assert cells[("3201", "Omsetninger")] == 3


@pytest.mark.parametrize(
    ("price", "sales", "expected"),
    [
        (98381.4, 21977, (98381, 21977)),
        (50000, 10, (50000, 10)),
        (50000, 9, None),  # R3: under 10 sales is no value
        (None, 500, None),  # R3: unpublished is no value
        (0, 500, None),
        (50000, None, None),
    ],
)
def test_priced_row_applies_the_sales_floor(price, sales, expected):
    assert build.priced_row(price, sales) == expected


def test_regions_are_fylker_with_oslo_and_akershus_combined():
    assert build.region_code_for_kommune("0301") == "NO03"
    assert build.region_code_for_kommune("3201") == "NO03"
    assert build.region_code_for_kommune("4601") == "NO46"


def test_oslo_codes_link_price_table_to_klass_and_income():
    assert build.oslo_label_to_klass("102") == "0102"
    assert build.oslo_label_to_klass("1505") == "1505"
    assert build.oslo_label_to_klass("15") is None  # a bydel
    assert build.oslo_label_to_klass("10201") is None  # a grunnkretsområde
    assert build.delbydel_area_id("0102") == "03010102"
    assert build.bydel_income_code("0102") == "030101a"
    assert build.bydel_income_code("1505") == "030115a"


def test_build_record_estimates_at_the_reference_size_and_labels_income():
    record = build.build_record("03010102", "Grønland", "Delbydel", 100_000, 335, 500_000, "bydel")
    assert record["median_value"] == 7_500_000
    assert record["price_per_m2"] == 100_000
    assert record["price_to_income"] == 15.0
    assert record["income_level"] == "bydel"


def test_build_record_omits_affordability_without_income():
    record = build.build_record("3201", "Bærum", "Kommune", 90_000, 40, None, None)
    assert "median_income" not in record
    assert "price_to_income" not in record


def test_utm33_inverse_matches_known_points():
    # On the central meridian at 60°N: northing = 0.9996 x the GRS80 meridian arc.
    lon, lat = build.utm33_to_lonlat(np.array([[500_000.0, 6_651_411.19]]))[0]
    assert lon == pytest.approx(15.0, abs=1e-6)
    assert lat == pytest.approx(60.0, abs=1e-5)
    # Off-meridian: Oslo Central Station, about 262 km west of the meridian.
    lon, lat = build.utm33_to_lonlat(np.array([[262_400.0, 6_649_500.0]]))[0]
    assert 10.7 < lon < 10.8
    assert 59.9 < lat < 59.95


def test_drop_small_parts_removes_islets_but_keeps_the_largest():
    big, islet = box(0, 0, 1000, 1000), box(5000, 5000, 5010, 5010)
    assert build.drop_small_parts(MultiPolygon([big, islet]), 500).equals(big)
    tiny = MultiPolygon([box(0, 0, 1, 1), box(5, 5, 6.5, 6.5)])
    assert not build.drop_small_parts(tiny, 1e9).is_empty
