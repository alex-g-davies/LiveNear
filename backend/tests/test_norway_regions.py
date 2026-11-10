"""Norway on the map, backend side (spec 026 R2, R4, R7, R8, R12, R13)."""

import datetime
import json
import shutil
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app import commute, data_loader, isochrone, tzlookup
from app.config import DATA_DIR, Settings, get_settings
from app.data_loader import DataStore, merge_geojson, normalize_area_id, parse_housing
from app.main import app

NORWAY = DATA_DIR / "norway"
OSLO = (59.9111, 10.7528)


def _load(state: str = "NO03", directory: Path = NORWAY) -> DataStore:
    return DataStore.load_norway(state, directory)


def test_area_ids_stay_opaque_strings():
    assert normalize_area_id("0301") == "0301"
    assert normalize_area_id("03010102") == "03010102"
    assert normalize_area_id(301) is None  # a number has already lost its zero
    assert normalize_area_id("abc") is None


def test_us_zip_handling_is_unchanged_by_default():
    raw = {"zips": [{"zip": 2139, "median_value": 500000}]}
    assert list(parse_housing(raw).records) == ["02139"]


def test_norwegian_records_keep_leading_zeros_through_geojson():
    raw = {"country": "NO", "zips": [{"zip": "0301", "median_value": 7_000_000}]}
    parsed = parse_housing(raw)
    assert list(parsed.records) == ["0301"]
    geo = {"features": [{"properties": {"zip": "0301"}, "geometry": None}]}
    merged = merge_geojson(geo, parsed.records, parsed.country)
    assert merged["features"][0]["properties"]["zip"] == "0301"
    assert merged["features"][0]["properties"]["median_value"] == 7_000_000


def test_oslo_and_akershus_shows_delbydeler_and_kommuner():
    store = _load()
    zips = {f["properties"]["zip"] for f in store.geojson["features"]}
    assert "0301" not in zips
    assert "03010102" in zips  # an Oslo delbydel
    assert "3201" in zips  # an Akershus kommune
    assert store.housing.records["03010102"].income_level == "bydel"


def test_area_without_a_price_stays_on_the_map_as_no_data():
    for path in sorted(NORWAY.glob("NO*.values.json")):
        state = path.name.split(".")[0]
        store = _load(state)
        for f in store.geojson["features"]:
            props = f["properties"]
            if props["zip"] not in store.housing.records:
                assert "median_value" not in props
                assert "price_per_m2" not in props
        assert all(r.sales >= 10 for r in store.housing.records.values())


def test_removing_the_oslo_output_leaves_one_polygon(tmp_path):
    for name in ("NO03.values.json", "NO03.geojson"):
        shutil.copy(NORWAY / name, tmp_path / name)
    store = _load(directory=tmp_path)
    zips = {f["properties"]["zip"] for f in store.geojson["features"]}
    assert "0301" in zips
    assert not any(len(z) == 8 for z in zips)
    assert "0301" in store.housing.records


def test_corrupt_oslo_output_also_falls_back(tmp_path):
    for name in ("NO03.values.json", "NO03.geojson"):
        shutil.copy(NORWAY / name, tmp_path / name)
    (tmp_path / "oslo_delbydeler.values.json").write_text("{not json", encoding="utf-8")
    (tmp_path / "oslo_delbydeler.geojson").write_text("{}", encoding="utf-8")
    assert "0301" in _load(directory=tmp_path).housing.records


def test_committed_norway_data_fits_its_budget():
    total = sum(p.stat().st_size for p in NORWAY.iterdir())
    assert total <= 5_000_000  # R5


def test_every_region_declares_its_presentation():
    for region in json.loads((NORWAY / "regions.json").read_text(encoding="utf-8")):
        assert region["country"] == "NO"
        assert region["currency"] == "NOK"
        assert region["timezone"] == "Europe/Oslo"
        assert "yoy" not in region["metrics"]
        assert region["reference_m2"] == 75


def test_oslo_uses_oslo_time_all_year(monkeypatch):
    monkeypatch.setattr(
        tzlookup,
        "load_regions",
        lambda: json.loads((NORWAY / "regions.json").read_text(encoding="utf-8")),
    )
    tz = tzlookup.tz_for(*OSLO)
    assert tz == ZoneInfo("Europe/Oslo")
    july = datetime.datetime(2026, 7, 15, 23, 30, tzinfo=tz)
    departure = isochrone.next_departure(16, july)
    assert departure > july.strftime("%Y-%m-%dT%H:%M")


def test_norway_rush_windows_replace_the_us_ones(monkeypatch):
    regions = json.loads((NORWAY / "regions.json").read_text(encoding="utf-8"))
    monkeypatch.setattr(tzlookup, "load_regions", lambda: regions)
    # Measured live on 2026-11-10: Oslo S to Asker peaked near 15:30 (026 R13).
    assert dict((k, h) for k, h, _ in isochrone.scenarios_for(*OSLO))["peak"] == 15
    am, pm = commute.rush_windows(*OSLO)
    assert am[0] == (7, 0)
    assert pm == [(15, 0), (15, 30), (16, 15)]
    assert len(am) + len(pm) == commute.calls_needed("drive")


def test_us_rush_windows_are_unchanged():
    assert commute.rush_windows(47.6, -122.3) == (
        list(commute.AM_DEPARTURES),
        list(commute.PM_DEPARTURES),
    )
    assert isochrone.scenarios_for(47.6, -122.3) == isochrone.SCENARIOS


@pytest.fixture
def client_with_token(tmp_path, monkeypatch):
    regions_file = tmp_path / "regions.json"
    shutil.copy(NORWAY / "regions.json", regions_file)
    monkeypatch.setattr(data_loader, "REGIONS_FILE", regions_file)
    data_loader.load_regions.cache_clear()
    app.dependency_overrides[get_settings] = lambda: Settings(mapbox_token="test-token")
    yield TestClient(app)
    app.dependency_overrides.pop(get_settings, None)


@pytest.mark.parametrize(
    ("center", "status"),
    [
        ([10.7528, 59.9111], 200),  # Oslo
        ([15.6, 78.2], 404),  # Svalbard is in Norway but outside the map
    ],
)
def test_geocoder_searches_norway_and_refuses_uncovered_results(
    client_with_token, httpx_mock, center, status
):
    from app import geocode as geocode_module

    geocode_module.clear_cache()
    httpx_mock.add_response(json={"features": [{"center": center, "place_name": "Somewhere"}]})
    r = client_with_token.get("/api/geocode", params={"q": f"place {center[1]}"})
    assert r.status_code == status
    assert "country=us%2Cno" in str(httpx_mock.get_requests()[0].url)


def test_a_biased_search_stays_in_its_regions_country(client_with_token, httpx_mock):
    """From Oslo, a Stockholm address must not fuzzy-match a US place (R12)."""
    from app import geocode as geocode_module

    geocode_module.clear_cache()
    httpx_mock.add_response(json={"features": []})
    r = client_with_token.get(
        "/api/geocode",
        params={"q": "Sveavagen 1, Stockholm", "proximity_lat": OSLO[0], "proximity_lon": OSLO[1]},
    )
    assert r.status_code == 404
    assert "country=no&" in str(httpx_mock.get_requests()[0].url) + "&"


def test_a_partial_match_is_refused(client_with_token, httpx_mock):
    """Live shape: the street matched in Oslo, the city "Stockholm" did not (R12)."""
    from app import geocode as geocode_module

    geocode_module.clear_cache()
    feature = {"center": [10.8041, 59.8404], "place_name": "Sveavegen 1, 1263 Oslo, Norway"}
    httpx_mock.add_response(json={"features": [{**feature, "relevance": 0.548}]})
    r = client_with_token.get("/api/geocode", params={"q": "Sveavagen 1, Stockholm"})
    assert r.status_code == 404


def test_country_filter_follows_the_bias_point(monkeypatch):
    from app import geocode as geocode_module

    us = {"code": "WA", "bbox": [-125, 45, -116, 49.5], "center": [-120, 47]}
    no = json.loads((NORWAY / "regions.json").read_text(encoding="utf-8"))
    monkeypatch.setattr(tzlookup, "load_regions", lambda: [us, *no])
    assert geocode_module.countries_for(*OSLO) == "no"
    assert geocode_module.countries_for(47.6, -122.3) == "us"
    assert geocode_module.countries_for(None, None) == "us,no"
    assert geocode_module.countries_for(0.0, 0.0) == "us,no"
