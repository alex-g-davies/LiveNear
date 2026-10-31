"""Bundle build with fitted listings (R7, R9): `build_bundle(listings=...)`
fits eb-v1, writes the JSON files to a temp dir, and `get_bundle` loads them.
The committed bundle under data/cars/ is never touched here."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from app.cars import data_bundle
from app.cars.bundle_schema import CohortPoint, MarketModelParams
from app.cars.data_bundle import FIXTURE_LISTINGS, parse_listings_csv
from app.cars.market import seeds
from app.cars.market.bundle import BUNDLE_DIR, build_bundle, cohort_points, fit_params_from_listings

BACKEND = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def fixture_listings():
    vehicles = seeds.load_vehicles()
    return vehicles, parse_listings_csv(FIXTURE_LISTINGS.read_text(encoding="utf-8"), vehicles)


def test_build_bundle_fits_from_listings_into_tmp_dir(tmp_path, fixture_listings):
    vehicles, listings = fixture_listings
    out = tmp_path / "bundle"
    before = {p.name: p.stat().st_mtime_ns for p in BUNDLE_DIR.glob("*.json")}
    meta = build_bundle(out_dir=out, listings=listings)
    assert {
        p.name: p.stat().st_mtime_ns for p in BUNDLE_DIR.glob("*.json")
    } == before  # committed untouched
    assert meta.bundle_as_of == max(x.snapshot_date for x in listings) == date(2026, 10, 31)
    names = {p.name for p in out.glob("*.json")}
    assert names == {
        "meta.json",
        "vehicles.json",
        "cohorts.json",
        "market_model.json",
        "new_prices.json",
        "lease_offers.json",
        "rates.json",
    }
    params = MarketModelParams.model_validate(
        json.loads((out / "market_model.json").read_text(encoding="utf-8"))
    )
    assert params.version == "eb-v1" and params.status == "live"
    fitted = {k: v for k, v in params.variants.items() if v.cohorts}
    assert len(fitted) == 8
    cohorts = [
        CohortPoint.model_validate(c)
        for c in json.loads((out / "cohorts.json").read_text(encoding="utf-8"))
    ]
    assert len(cohorts) == sum(len(v.model_years) for v in vehicles)
    live = [c for c in cohorts if c.n_listings >= 5]
    assert len(live) == 22 and all(c.status == "live" for c in live)
    for c in live:
        assert c.pi_low_ore < c.value_ref_ore < c.pi_high_ore and 0 < c.sigma_car < 0.3
    listings_health = next(s for s in meta.sources if s.name == "listings CSV")
    assert listings_health.rows == 264 and listings_health.status == "manual"


def test_get_bundle_loads_fitted_bundle(tmp_path, fixture_listings, monkeypatch):
    vehicles, listings = fixture_listings
    out = tmp_path / "bundle"
    build_bundle(out_dir=out, listings=listings)
    data_bundle.clear_cache()
    monkeypatch.delenv("CARS_R2_BUCKET", raising=False)
    b = data_bundle.get_bundle(bundle_dir=out, production=False)
    try:
        assert b.market.version == "eb-v1"
        assert b.listings_mode == "fixture" and len(b.listings) == 1487
        point = b.cohort("tesla-model3-rwd:2022")
        assert point is not None and point.n_listings == 12
        assert len(b.listings_for("tesla-model3-rwd:2022")) > 12  # all snapshots behind the point
        prod = data_bundle.get_bundle.__wrapped__(bundle_dir=out, production=True)
        assert prod.listings_mode == "unavailable" and prod.listings == []
    finally:
        data_bundle.clear_cache()


def test_explicit_params_win_and_priors_only_still_works(tmp_path, fixture_listings):
    vehicles, listings = fixture_listings
    prices = seeds.load_new_prices()
    priors = seeds.load_retention_priors(vehicles, prices)
    meta = build_bundle(out_dir=tmp_path / "priors", params=priors, listings=listings)
    saved = MarketModelParams.model_validate(
        json.loads((tmp_path / "priors" / "market_model.json").read_text())
    )
    assert saved.version == "priors-v0"
    assert next(s for s in meta.sources if s.name == "listings CSV").status == "disabled"
    fitted = fit_params_from_listings(listings, vehicles, prices, priors, date(2026, 10, 31))
    assert fitted.version == "eb-v1"
    pts = cohort_points(vehicles, fitted, date(2026, 10, 31))
    assert all(p.note == "" for p in pts if p.n_listings >= 5)


def test_build_script_writes_report_to_tmp(tmp_path):
    import subprocess
    import sys

    out = tmp_path / "b"
    report = tmp_path / "backtest.md"
    cmd = [
        sys.executable,
        str(BACKEND / "scripts" / "cars_build_bundle.py"),
        "--synthetic",
        "--out",
        str(out),
        "--report",
        str(report),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, cwd=BACKEND, check=False)
    assert res.returncode == 0, res.stderr
    assert "gate=PASS" in res.stdout and (out / "market_model.json").exists()
    assert "**Gate: PASS**" in report.read_text(encoding="utf-8")
