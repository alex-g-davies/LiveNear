"""R3/003: commute reach with time-of-day variation bands. R5: the Mapbox token
reaches Mapbox but never the client, and never appears in error details."""

import datetime
from zoneinfo import ZoneInfo

import pytest
from shapely.geometry import box

from app.isochrone import (
    enforce_nesting,
    geodesic_area_sqmi,
    next_departure,
    summarize_variation,
)

TOKEN = "test-token-do-not-leak"

# A small square polygon (~ closed ring) reused for every mocked Mapbox call.
_SQUARE = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"fill": "#abc", "contour": 30},
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


# --- pure helpers --------------------------------------------------------------


def test_next_departure_is_future_weekday_at_hour():
    # A Saturday -> the 8am departure must roll forward to Monday.
    sat = datetime.datetime(2026, 6, 13, 10, 0, tzinfo=ZoneInfo("America/Los_Angeles"))
    out = next_departure(8, sat)
    assert out == "2026-06-15T08:00"  # Monday
    dt = datetime.datetime.fromisoformat(out)
    assert dt.weekday() < 5 and dt > sat.replace(tzinfo=None)


def test_next_departure_same_day_if_hour_still_ahead():
    wed = datetime.datetime(2026, 6, 10, 6, 0, tzinfo=ZoneInfo("America/Los_Angeles"))
    assert next_departure(8, wed) == "2026-06-10T08:00"  # same weekday, later today


def test_geodesic_area_sqmi_positive_and_reasonable():
    geom = _SQUARE["features"][0]["geometry"]
    area = geodesic_area_sqmi(geom)
    # ~0.2 deg lon (~15 km) x 0.15 deg lat (~16.6 km) near 47.6N -> ~95 sq mi.
    assert 80 < area < 120


def test_enforce_nesting_clips_inner_bands_to_outer():
    # typical sits inside offpeak; peak BULGES outside both (raw peak > typical).
    offpeak = box(0, 0, 10, 10)  # area 100
    typical = box(1, 1, 9, 9)  # area 64
    peak = box(2, 2, 12, 12)  # area 100 raw, but should clip to <= typical
    out = enforce_nesting([("offpeak", offpeak), ("typical", typical), ("peak", peak)])
    geoms = {scen: g for scen, g in out}

    assert geoms["offpeak"].area == 100
    assert geoms["typical"].area == 64
    assert geoms["peak"].area == 49  # box(2,2,9,9) after chained clip
    # strictly nested
    assert geoms["peak"].area <= geoms["typical"].area <= geoms["offpeak"].area
    assert geoms["typical"].covers(geoms["peak"])
    assert geoms["offpeak"].covers(geoms["typical"])


def test_summarize_variation_computes_peak_shrink():
    s = summarize_variation({"offpeak": 200.0, "typical": 150.0, "peak": 140.0})
    assert s["offpeak_sqmi"] == 200.0 and s["peak_sqmi"] == 140.0
    assert s["peak_shrink_pct"] == 30.0  # (200-140)/200
    assert summarize_variation({"offpeak": 200.0})["peak_shrink_pct"] is None


# --- endpoint ------------------------------------------------------------------


def test_fixture_mode_single_band_no_token(make_client):
    client = make_client(mapbox_token="")
    r = client.get("/api/isochrone", params={"minutes": 45})
    assert r.status_code == 200
    fc = r.json()
    assert fc["properties"]["contour_minutes"] == 45
    assert fc["properties"]["variation"] is None
    assert len(fc["features"]) == 1
    assert fc["features"][0]["properties"]["scenario"] == "typical"
    assert "fill" not in fc["features"][0]["properties"]  # styling stripped


def test_production_without_token_returns_503_not_fixture(make_client, httpx_mock):
    """021 R1: with STATIC_DIR set (production) and no token, the endpoint must
    fail loudly — never serve the static Seattle polygon as if it were live."""
    client = make_client(mapbox_token="", static_dir="/app/static")
    r = client.get("/api/isochrone", params={"minutes": 30})
    assert r.status_code == 503
    assert "no token" in r.json()["detail"]
    assert httpx_mock.get_requests() == []  # nothing went upstream either


def test_production_use_fixture_override_still_serves_fixture(make_client):
    """USE_FIXTURE=true is the explicit opt-in (CI's Docker smoke test)."""
    client = make_client(mapbox_token="", static_dir="/app/static", use_fixture=True)
    r = client.get("/api/isochrone", params={"minutes": 30})
    assert r.status_code == 200
    assert [f["properties"]["scenario"] for f in r.json()["features"]] == ["typical"]


def test_live_mode_returns_three_variation_bands(make_client, httpx_mock):
    httpx_mock.add_response(json=_SQUARE, is_reusable=True)
    client = make_client(mapbox_token=TOKEN)

    r = client.get("/api/isochrone", params={"minutes": 30})
    assert r.status_code == 200
    fc = r.json()
    scenarios = [f["properties"]["scenario"] for f in fc["features"]]
    assert scenarios == ["offpeak", "typical", "peak"]  # largest -> smallest, peak on top
    for f in fc["features"]:
        assert f["geometry"]["type"] == "Polygon"
        assert f["properties"]["area_sqmi"] > 0
        assert f["properties"]["contour_minutes"] == 30
    # Clipping guarantees the bands nest -> areas are monotonic non-increasing.
    areas = [f["properties"]["area_sqmi"] for f in fc["features"]]
    assert areas[0] >= areas[1] >= areas[2]
    assert fc["properties"]["variation"]["peak_shrink_pct"] is not None


def test_token_sent_to_mapbox_but_not_to_client(make_client, httpx_mock):
    httpx_mock.add_response(json=_SQUARE, is_reusable=True)
    client = make_client(mapbox_token=TOKEN)

    r = client.get("/api/isochrone")
    reqs = httpx_mock.get_requests()
    assert len(reqs) == 3  # one per scenario
    for req in reqs:
        url = str(req.url)
        assert TOKEN in url
        assert "driving-traffic" in url and "depart_at" in url
    assert TOKEN not in r.text
    assert all(TOKEN not in v for v in r.headers.values())


def test_response_is_cached_three_calls_for_two_requests(make_client, httpx_mock):
    httpx_mock.add_response(json=_SQUARE, is_reusable=True)
    client = make_client(mapbox_token=TOKEN)

    first = client.get("/api/isochrone", params={"minutes": 30})
    second = client.get("/api/isochrone", params={"minutes": 30})
    assert first.json() == second.json()
    assert len(httpx_mock.get_requests()) == 3  # second served from cache


def test_partial_failure_still_renders_succeeding_scenarios(make_client, httpx_mock):
    # First scenario fails, the other two succeed -> 2 bands, still 200.
    httpx_mock.add_response(status_code=500)
    httpx_mock.add_response(json=_SQUARE, is_reusable=True)
    client = make_client(mapbox_token=TOKEN)

    r = client.get("/api/isochrone")
    assert r.status_code == 200
    assert len(r.json()["features"]) == 2


def test_all_scenarios_fail_returns_503_without_token(make_client, httpx_mock):
    httpx_mock.add_response(status_code=500, is_reusable=True)
    client = make_client(mapbox_token=TOKEN)

    r = client.get("/api/isochrone")
    assert r.status_code == 503
    assert TOKEN not in r.text


@pytest.mark.parametrize("bad", [10, 35, 90, 120, 0])
def test_invalid_minutes_rejected(make_client, bad):
    client = make_client(mapbox_token=TOKEN)
    assert client.get("/api/isochrone", params={"minutes": bad}).status_code == 422


# --- travel modes (spec 013 R2) -------------------------------------------------


def test_walk_mode_single_untimed_contour(make_client, httpx_mock):
    httpx_mock.add_response(json=_SQUARE)
    client = make_client(mapbox_token=TOKEN)
    r = client.get("/api/isochrone", params={"minutes": 30, "mode": "walk"})
    assert r.status_code == 200
    fc = r.json()
    assert len(fc["features"]) == 1
    assert fc["features"][0]["properties"]["scenario"] == "typical"
    assert fc["features"][0]["properties"]["label"] == "Walking"
    assert fc["properties"]["variation"] is None

    reqs = httpx_mock.get_requests()
    assert len(reqs) == 1  # one call, not three scenarios
    url = str(reqs[0].url)
    assert "/walking/" in url
    assert "depart_at" not in url


def test_mode_caches_are_separate(make_client, httpx_mock):
    httpx_mock.add_response(json=_SQUARE, is_reusable=True)
    client = make_client(mapbox_token=TOKEN)
    assert client.get("/api/isochrone", params={"minutes": 30}).status_code == 200  # 3 calls
    assert (
        client.get("/api/isochrone", params={"minutes": 30, "mode": "cycle"}).status_code == 200
    )  # +1
    assert client.get("/api/isochrone", params={"minutes": 30}).status_code == 200  # cached
    assert len(httpx_mock.get_requests()) == 4


def test_invalid_mode_rejected(make_client):
    client = make_client(mapbox_token=TOKEN)
    assert client.get("/api/isochrone", params={"mode": "transit"}).status_code == 422
