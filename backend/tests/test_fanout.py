"""Parallel Mapbox fan-out (020 follow-up): the helper runs a batch
concurrently, preserves order, and mirrors per-task failures back."""

import threading
import time

import httpx

from app import commute as commute_module
from app import isochrone as iso_module
from app.fanout import run_parallel


def test_run_parallel_preserves_order_and_returns_exceptions():
    def ok(v):
        return lambda: v

    def boom():
        raise ValueError("nope")

    out = run_parallel([ok(1), boom, ok(3)])
    assert out[0] == 1 and out[2] == 3
    assert isinstance(out[1], ValueError)
    assert run_parallel([]) == []
    assert run_parallel([ok("solo")]) == ["solo"]


def test_run_parallel_actually_overlaps():
    """Three 150 ms tasks must finish well under 450 ms in aggregate."""
    barrier = threading.Barrier(3, timeout=2)

    def task():
        barrier.wait()  # deadlocks (-> BrokenBarrierError) unless all 3 run at once
        time.sleep(0.15)
        return threading.get_ident()

    start = time.perf_counter()
    out = run_parallel([task, task, task])
    elapsed = time.perf_counter() - start
    assert all(isinstance(t, int) for t in out)
    assert len(set(out)) == 3  # three distinct worker threads
    assert elapsed < 0.45


def _slow_iso(monkeypatch, delay: float):
    calls: list[float] = []

    def fake(token, lat, lon, minutes, profile, depart_at):
        calls.append(time.perf_counter())
        time.sleep(delay)
        return {
            "features": [
                {
                    "properties": {},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
                    },
                }
            ]
        }

    monkeypatch.setattr(iso_module, "_fetch_contour", fake)
    return calls


def test_variation_scenarios_fetch_concurrently(monkeypatch):
    calls = _slow_iso(monkeypatch, 0.2)
    start = time.perf_counter()
    payload = iso_module.fetch_variation("tok", 47.6, -122.3, 30)
    elapsed = time.perf_counter() - start
    assert len(calls) == 3
    assert [f["properties"]["scenario"] for f in payload["features"]] == [
        "offpeak",
        "typical",
        "peak",
    ]
    assert elapsed < 0.5  # sequential would be >= 0.6


def test_variation_non_http_error_propagates(monkeypatch):
    def fake(*args):
        raise RuntimeError("bug, not an upstream failure")

    monkeypatch.setattr(iso_module, "_fetch_contour", fake)
    try:
        iso_module.fetch_variation("tok", 47.6, -122.3, 30)
    except RuntimeError:
        pass
    else:
        raise AssertionError("programming errors must not be swallowed as skipped scenarios")


def test_commute_samples_fetch_concurrently(monkeypatch):
    calls: list[str | None] = []

    def fake(token, profile, from_lat, from_lon, to_lat, to_lon, depart_at):
        calls.append(depart_at)
        time.sleep(0.15)
        return 30

    monkeypatch.setattr(commute_module, "_route_minutes", fake)
    start = time.perf_counter()
    payload = commute_module.fetch_commute("tok", 47.6, -122.3, 47.7, -122.2)
    elapsed = time.perf_counter() - start
    assert len(calls) == 6
    assert payload is not None and payload["am_min_minutes"] == 30
    assert elapsed < 0.5  # sequential would be >= 0.9


def test_commute_upstream_error_still_propagates(monkeypatch):
    def fake(*args):
        raise httpx.HTTPError("boom")

    monkeypatch.setattr(commute_module, "_route_minutes", fake)
    try:
        commute_module.fetch_commute("tok", 47.6, -122.3, 47.7, -122.2)
    except httpx.HTTPError:
        pass
    else:
        raise AssertionError("upstream failure must raise, not cache a no-route")
