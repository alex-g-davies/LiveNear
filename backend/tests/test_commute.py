"""Spec 013 R1/R2 (+ 011 R5/R6 carried forward): rush-window sampled commute
ranges, walk/cycle modes, snapping/caching, budget, guards, token safety."""

import re

TOKEN = "test-token-do-not-leak"

# Conftest fixture coverage: WA bbox [-122.36, 47.6, -122.28, 47.7].
HOME = {"from_lat": 47.61, "from_lon": -122.33}
WORK = {"to_lat": 47.65, "to_lon": -122.30}
PARAMS = {**HOME, **WORK}

OK_ROUTE = {"code": "Ok", "routes": [{"duration": 3120}]}  # 52 min


def ok(duration_s: int) -> dict:
    return {"code": "Ok", "routes": [{"duration": duration_s}]}


def test_drive_samples_rush_window_and_returns_ranges(make_client, httpx_mock):
    # AM samples: 50/60/55 min; PM samples: 55/73/64 min. Samples are fetched
    # concurrently (020 follow-up), so responses are matched by direction +
    # departure rather than by registration order.
    am_path, pm_path = "-122.33,47.61;-122.3,47.65", "-122.3,47.65;-122.33,47.61"
    for path, hhmm, d in (
        (am_path, "0715", 3000),
        (am_path, "0800", 3600),
        (am_path, "0845", 3300),
        (pm_path, "1630", 3300),
        (pm_path, "1715", 4380),
        (pm_path, "1800", 3840),
    ):
        # The colon in depart_at is percent-encoded on the wire.
        depart = f"T{hhmm[:2]}(?:%3A|:){hhmm[2:]}"
        httpx_mock.add_response(
            url=re.compile(rf".*{re.escape(path)}\?.*depart_at=[^&]*{depart}.*"), json=ok(d)
        )
    client = make_client(mapbox_token=TOKEN)
    r = client.get("/api/commute", params=PARAMS)
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "drive"
    assert (body["am_min_minutes"], body["am_max_minutes"]) == (50, 60)
    assert (body["pm_min_minutes"], body["pm_max_minutes"]) == (55, 73)
    assert "T07:15" in body["am_window_start_local"]
    assert "T08:45" in body["am_window_end_local"]
    assert "T16:30" in body["pm_window_start_local"]
    assert "T18:00" in body["pm_window_end_local"]

    reqs = httpx_mock.get_requests()
    assert len(reqs) == 6
    for req in reqs:
        url = str(req.url)
        assert "driving-traffic" in url and "depart_at=" in url and TOKEN in url
    assert TOKEN not in r.text
    # AM legs go home->work; PM legs are reversed (three samples each).
    paths = [req.url.path for req in reqs]
    assert sum(p.endswith(am_path) for p in paths) == 3
    assert sum(p.endswith(pm_path) for p in paths) == 3


def test_walk_mode_two_untimed_calls_min_equals_max(make_client, httpx_mock):
    httpx_mock.add_response(json=ok(5100), is_reusable=True)  # 85 min each way
    client = make_client(mapbox_token=TOKEN)
    r = client.get("/api/commute", params={**PARAMS, "mode": "walk"})
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "walk"
    assert body["am_min_minutes"] == body["am_max_minutes"] == 85
    assert body["am_window_start_local"] is None and body["pm_window_end_local"] is None

    reqs = httpx_mock.get_requests()
    assert len(reqs) == 2
    for req in reqs:
        url = str(req.url)
        assert "/walking/" in url
        assert "depart_at" not in url


def test_invalid_mode_rejected(make_client):
    client = make_client(mapbox_token=TOKEN)
    assert client.get("/api/commute", params={**PARAMS, "mode": "transit"}).status_code == 422


def test_partial_sample_failure_still_yields_a_range(make_client, httpx_mock):
    # One AM sample (08:00) has no route; the other two still produce a range.
    am_path = "-122.33,47.61;-122.3,47.65"
    no_route = {"code": "NoRoute", "routes": []}
    for hhmm, body in (("0715", ok(3000)), ("0800", no_route), ("0845", ok(3600))):
        depart = f"T{hhmm[:2]}(?:%3A|:){hhmm[2:]}"
        httpx_mock.add_response(
            url=re.compile(rf".*{re.escape(am_path)}\?.*depart_at=[^&]*{depart}.*"), json=body
        )
    httpx_mock.add_response(json=ok(3300), is_reusable=True)  # every PM sample
    client = make_client(mapbox_token=TOKEN)
    r = client.get("/api/commute", params=PARAMS)
    assert r.status_code == 200
    body = r.json()
    assert (body["am_min_minutes"], body["am_max_minutes"]) == (50, 60)


def test_commute_cached_by_snapped_endpoints_and_mode(make_client, httpx_mock):
    httpx_mock.add_response(json=OK_ROUTE, is_reusable=True)
    client = make_client(mapbox_token=TOKEN)
    assert client.get("/api/commute", params=PARAMS).status_code == 200  # 6 calls
    assert client.get("/api/commute", params=PARAMS).status_code == 200  # cached
    nudged = {**PARAMS, "from_lat": 47.6109, "from_lon": -122.3304}  # same 500m cell
    assert client.get("/api/commute", params=nudged).status_code == 200  # cached
    assert client.get("/api/commute", params={**PARAMS, "mode": "walk"}).status_code == 200
    assert len(httpx_mock.get_requests()) == 8  # 6 drive + 2 walk


def test_budget_reserves_per_mode(make_client, httpx_mock):
    httpx_mock.add_response(json=OK_ROUTE, is_reusable=True)
    client = make_client(mapbox_token=TOKEN, mapbox_daily_call_budget=7)
    assert client.get("/api/commute", params=PARAMS).status_code == 200  # spends 6, 1 left
    far = {**PARAMS, "from_lat": 47.69, "from_lon": -122.29}
    assert client.get("/api/commute", params=far).status_code == 503  # needs 6
    # Walk needs 2 — still too much for the remaining 1.
    assert client.get("/api/commute", params={**far, "mode": "walk"}).status_code == 503
    assert len(httpx_mock.get_requests()) == 6


def test_commute_geofence_and_distance_guards(make_client, httpx_mock):
    client = make_client(mapbox_token=TOKEN)
    out = client.get("/api/commute", params={"from_lat": 0, "from_lon": 0, **WORK})
    assert out.status_code == 422
    assert "covered regions" in out.json()["detail"]
    cross = client.get("/api/commute", params={**HOME, "to_lat": 40.05, "to_lon": -82.65})
    assert cross.status_code == 422
    assert "too far apart" in cross.json()["detail"]
    assert len(httpx_mock.get_requests()) == 0


def test_commute_requires_token(make_client):
    client = make_client(mapbox_token="")
    r = client.get("/api/commute", params=PARAMS)
    assert r.status_code == 503
    assert "token" in r.json()["detail"]


def test_commute_upstream_error_503_without_token_leak(make_client, httpx_mock):
    httpx_mock.add_response(status_code=500, is_reusable=True)
    client = make_client(mapbox_token=TOKEN)
    r = client.get("/api/commute", params=PARAMS)
    assert r.status_code == 503
    assert TOKEN not in r.text


def test_commute_no_route_404_and_cached(make_client, httpx_mock):
    httpx_mock.add_response(json={"code": "NoRoute", "routes": []}, is_reusable=True)
    client = make_client(mapbox_token=TOKEN)
    assert client.get("/api/commute", params=PARAMS).status_code == 404
    assert client.get("/api/commute", params=PARAMS).status_code == 404  # cached miss
    assert len(httpx_mock.get_requests()) == 6  # only the first attempt's samples


def test_commute_rejects_out_of_range_params(make_client):
    client = make_client(mapbox_token=TOKEN)
    assert client.get("/api/commute", params={**PARAMS, "from_lat": 91}).status_code == 422
