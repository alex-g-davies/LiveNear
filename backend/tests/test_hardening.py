"""Spec 004: abuse protection and production behavior of the public API.

R1 rate limiting, R2 geofence + origin snapping, R3 daily budget breaker,
R4 ETag/304/gzip, R6 health, R7 graceful data failure.
"""

import json
import time

from app import data_loader
from app import isochrone as iso_module

TOKEN = "test-token-do-not-leak"

_SQUARE = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {},
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [-122.40, 47.55],
                        [-122.20, 47.55],
                        [-122.20, 47.70],
                        [-122.40, 47.70],
                        [-122.40, 47.55],
                    ]
                ],
            },
        }
    ],
}


# --- R1: rate limiting -----------------------------------------------------


def test_isochrone_rate_limited_after_ten_requests(make_client):
    client = make_client(mapbox_token="")  # fixture mode: no upstream calls
    statuses = [client.get("/api/isochrone").status_code for _ in range(11)]
    assert statuses[:10] == [200] * 10
    assert statuses[10] == 429


def test_rate_limit_keyed_by_forwarded_ip(make_client):
    client = make_client(mapbox_token="")
    for _ in range(10):
        assert (
            client.get("/api/isochrone", headers={"X-Forwarded-For": "1.2.3.4"}).status_code == 200
        )
    assert client.get("/api/isochrone", headers={"X-Forwarded-For": "1.2.3.4"}).status_code == 429
    # A different client IP still has budget.
    assert client.get("/api/isochrone", headers={"X-Forwarded-For": "5.6.7.8"}).status_code == 200


# --- R2: geofence + snapping -------------------------------------------------


def test_out_of_coverage_origin_rejected(make_client):
    client = make_client(mapbox_token=TOKEN)
    r = client.get("/api/isochrone", params={"lat": 0.0, "lon": 0.0, "minutes": 30})
    assert r.status_code == 422
    assert "covered regions" in r.json()["detail"]


def test_nearby_origins_share_one_upstream_fetch(make_client, httpx_mock):
    httpx_mock.add_response(json=_SQUARE, is_reusable=True)
    client = make_client(mapbox_token=TOKEN)

    # Two pins ~100 m apart -> same 0.005-degree cell -> 3 calls total, not 6.
    a = client.get("/api/isochrone", params={"lat": 47.6062, "lon": -122.3321, "minutes": 30})
    b = client.get("/api/isochrone", params={"lat": 47.6071, "lon": -122.3315, "minutes": 30})
    assert a.status_code == b.status_code == 200
    assert len(httpx_mock.get_requests()) == 3


def test_snap_origin_grid():
    lat, lon = iso_module.snap_origin(47.6062, -122.3321)
    assert lat == 47.605 and lon == -122.33
    assert iso_module.snap_origin(47.6071, -122.3315) == (lat, lon)


# --- R3: daily budget breaker -------------------------------------------------


def test_budget_exhausted_returns_503_with_no_upstream_calls(make_client, httpx_mock):
    # Budget of 2 cannot cover the 3 scenario calls -> 503 before any fetch.
    client = make_client(mapbox_token=TOKEN, mapbox_daily_call_budget=2)
    r = client.get("/api/isochrone", params={"minutes": 30})
    assert r.status_code == 503
    assert len(httpx_mock.get_requests()) == 0


def test_budget_exhausted_serves_stale_cache(make_client):
    # Seed an EXPIRED cache entry for the snapped default work location, then
    # exhaust the budget: the stale payload must be served rather than 503.
    lat, lon = iso_module.snap_origin(47.6062, -122.3321)
    stale = {"type": "FeatureCollection", "properties": {"stale": True}, "features": []}
    iso_module._CACHE[(lon, lat, 30, "drive")] = (time.time() - 1, stale)

    client = make_client(mapbox_token=TOKEN, mapbox_daily_call_budget=1)
    r = client.get("/api/isochrone", params={"minutes": 30})
    assert r.status_code == 200
    assert r.json()["properties"]["stale"] is True


def test_geocode_budget_exhausted_503(make_client, httpx_mock):
    client = make_client(mapbox_token=TOKEN, mapbox_daily_call_budget=0)
    # 0 disables the breaker entirely; geocode goes upstream as usual.
    httpx_mock.add_response(
        json={"features": [{"center": [-122.3, 47.6], "place_name": "Seattle"}]}
    )
    assert client.get("/api/geocode", params={"q": "seattle"}).status_code == 200

    client2 = make_client(mapbox_token=TOKEN, mapbox_daily_call_budget=1)
    httpx_mock.add_response(json={"features": [{"center": [-122.3, 47.6], "place_name": "Tacoma"}]})
    assert client2.get("/api/geocode", params={"q": "tacoma"}).status_code == 200
    # Budget (1) now spent; an uncached query must NOT reach Mapbox.
    assert client2.get("/api/geocode", params={"q": "spokane"}).status_code == 503
    assert len(httpx_mock.get_requests()) == 2


# --- R4: HTTP caching + gzip ---------------------------------------------------


def test_zips_geojson_etag_304(client):
    first = client.get("/api/zips.geojson")
    assert first.status_code == 200
    etag = first.headers["etag"]
    # no-cache = always revalidate against the ETag (data updates appear
    # immediately; unchanged data still costs only a 304).
    assert "no-cache" in first.headers["cache-control"]

    second = client.get("/api/zips.geojson", headers={"If-None-Match": etag})
    assert second.status_code == 304
    assert second.content == b""


def test_housing_etag_304_distinct_from_geojson(client):
    geo = client.get("/api/zips.geojson")
    housing = client.get("/api/housing")
    assert housing.headers["etag"] != geo.headers["etag"]
    assert (
        client.get("/api/housing", headers={"If-None-Match": housing.headers["etag"]}).status_code
        == 304
    )


def test_geojson_gzipped_when_accepted(client):
    r = client.get("/api/zips.geojson", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers.get("content-encoding") == "gzip"
    assert r.json()["type"] == "FeatureCollection"  # transparently decompressed


# --- R6: health ------------------------------------------------------------------


def test_health_reports_states(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["states"] == 2
    assert body["isochrone"] == "live"  # conftest client carries a token


def test_health_reports_isochrone_mode(make_client):
    """021 R2: the probe distinguishes a live token, dev fixture mode, and a
    production deploy that is missing its token."""
    dev = make_client(mapbox_token="")
    assert dev.get("/api/health").json()["isochrone"] == "fixture"
    prod = make_client(mapbox_token="", static_dir="/app/static")
    assert prod.get("/api/health").json()["isochrone"] == "unavailable"


def test_health_503_without_region_index(client, tmp_path, monkeypatch):
    monkeypatch.setattr(data_loader, "REGIONS_FILE", tmp_path / "missing.json")
    data_loader.load_regions.cache_clear()
    r = client.get("/api/health")
    assert r.status_code == 503
    assert r.json()["status"] == "unavailable"


# --- R7: graceful data failure ------------------------------------------------


def test_corrupt_state_file_returns_503_not_500(client):
    (data_loader.STATES_DIR / "WA.zhvi.json").write_text("{not json", encoding="utf-8")
    data_loader.get_data_store.cache_clear()

    r = client.get("/api/housing", params={"state": "WA"})
    assert r.status_code == 503
    assert "temporarily unavailable" in r.json()["detail"]
    # Other states keep working.
    assert client.get("/api/housing", params={"state": "OH"}).status_code == 200


def test_missing_state_file_returns_503(client):
    (data_loader.STATES_DIR / "OH.geojson").unlink()
    data_loader.get_data_store.cache_clear()
    assert client.get("/api/zips.geojson", params={"state": "OH"}).status_code == 503


def test_etag_changes_when_data_changes(client, monkeypatch):
    first = client.get("/api/zips.geojson").headers["etag"]
    zhvi_path = data_loader.STATES_DIR / "WA.zhvi.json"
    payload = json.loads(zhvi_path.read_text(encoding="utf-8"))
    payload["as_of"] = "2031-01-31"
    zhvi_path.write_text(json.dumps(payload), encoding="utf-8")
    data_loader.get_data_store.cache_clear()
    assert client.get("/api/zips.geojson").headers["etag"] != first
