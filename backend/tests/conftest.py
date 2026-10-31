"""Shared pytest fixtures: a TestClient pointed at a temp per-state dataset (built
from the sample fixtures) and a fake token, plus clean caches per test."""

import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import commute as commute_module
from app import data_loader, usage
from app import geocode as geo_module
from app import isochrone as iso_module
from app.cars import data_bundle as cars_bundle
from app.config import Settings, get_settings
from app.main import app
from app.ratelimit import limiter
from app.routers import cars as cars_router

FIXTURES = Path(__file__).parent / "fixtures"


def _make_settings(**overrides) -> Settings:
    base = dict(
        mapbox_token="test-token-do-not-leak",
        work_lat=47.6062,
        work_lon=-122.3321,
        contour_minutes=30,
        use_fixture=False,
        _env_file=None,  # don't read a real .env during tests
    )
    base.update(overrides)
    return Settings(**base)


@pytest.fixture(autouse=True)
def _clear_caches():
    iso_module.clear_cache()
    geo_module.clear_cache()
    commute_module.clear_cache()
    usage.reset()
    limiter.reset()
    cars_router.clear_cache()
    cars_bundle.clear_cache()
    yield
    iso_module.clear_cache()
    geo_module.clear_cache()
    commute_module.clear_cache()
    usage.reset()
    limiter.reset()
    cars_router.clear_cache()
    cars_bundle.clear_cache()


@pytest.fixture(autouse=True)
def _state_data(tmp_path, monkeypatch):
    """Point the loader at a temp 2-state dataset (WA from the sample fixtures +
    a minimal OH) so the region-scoped endpoints have data."""
    sdir = tmp_path / "states"
    sdir.mkdir()

    sample = json.loads((FIXTURES / "sample_zhvi.json").read_text(encoding="utf-8"))
    wa = {"state": "WA", "name": "Washington", "as_of": sample["as_of"], "zips": sample["zips"]}
    (sdir / "WA.zhvi.json").write_text(json.dumps(wa), encoding="utf-8")
    shutil.copy(FIXTURES / "sample_zcta.geojson", sdir / "WA.geojson")

    (sdir / "OH.zhvi.json").write_text(
        json.dumps(
            {
                "state": "OH",
                "name": "Ohio",
                "as_of": "2024-12-31",
                "zips": [{"zip": "43001", "median_value": 160000}],
            }
        ),
        encoding="utf-8",
    )
    (sdir / "OH.geojson").write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"zip": "43001"},
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [
                                [
                                    [-82.7, 40.0],
                                    [-82.6, 40.0],
                                    [-82.6, 40.1],
                                    [-82.7, 40.1],
                                    [-82.7, 40.0],
                                ]
                            ],
                        },
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    regions = [
        {
            "code": "WA",
            "name": "Washington",
            "bbox": [-122.36, 47.6, -122.28, 47.7],
            "center": [-122.32, 47.65],
            "zip_count": 5,
        },
        {
            "code": "OH",
            "name": "Ohio",
            "bbox": [-82.7, 40.0, -82.6, 40.1],
            "center": [-82.65, 40.05],
            "zip_count": 1,
        },
    ]
    rfile = tmp_path / "regions.json"
    rfile.write_text(json.dumps(regions), encoding="utf-8")

    monkeypatch.setattr(data_loader, "STATES_DIR", sdir)
    monkeypatch.setattr(data_loader, "REGIONS_FILE", rfile)
    data_loader.get_data_store.cache_clear()
    data_loader.load_regions.cache_clear()
    yield
    data_loader.get_data_store.cache_clear()
    data_loader.load_regions.cache_clear()


@pytest.fixture
def client():
    app.dependency_overrides[get_settings] = lambda: _make_settings()
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def make_client():
    """Factory to build a client with custom settings overrides."""

    def _factory(**overrides):
        app.dependency_overrides[get_settings] = lambda: _make_settings(**overrides)
        return TestClient(app)

    yield _factory
    app.dependency_overrides.clear()


@pytest.fixture
def mapbox_response() -> dict:
    with open(FIXTURES / "mapbox_iso_response.json", encoding="utf-8") as f:
        return json.load(f)
