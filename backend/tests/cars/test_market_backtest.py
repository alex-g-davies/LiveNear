"""Backtest and report (R7, R12): coverage ~ 80 % on 1 000 synthetic listings,
the Wilson gate on the committed fixture, the Markdown renderer."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from app.cars.data_bundle import FIXTURE_LISTINGS, parse_listings_csv
from app.cars.market import seeds, synthetic
from app.cars.market.backtest import GATE_UPPER, run_backtest, summarise, wilson
from app.cars.market.report import render_backtest_markdown

AS_OF = date(2026, 10, 31)
BACKTEST_MD = Path(__file__).resolve().parents[2] / "docs" / "cars" / "backtest.md"


@pytest.fixture(scope="module")
def seed_data():
    vehicles = seeds.load_vehicles()
    prices = seeds.load_new_prices()
    return vehicles, prices, seeds.load_retention_priors(vehicles, prices)


def test_wilson_interval():
    lo, hi = wilson(80, 100)
    assert 0.70 < lo < 0.80 < hi < 0.88
    assert wilson(0, 0) == (0.0, 1.0)
    assert 0.95 < wilson(10, 10)[1] <= 1.0 and wilson(10, 10)[0] > 0.6
    import numpy as np

    c = summarise(np.array([0.1, 0.2]), np.array([True, False]))
    assert c.n == 2 and c.mape == pytest.approx(0.15) and c.coverage == 0.5


def test_coverage_near_eighty_percent_on_thousand_listings(seed_data):
    vehicles, prices, priors = seed_data
    rows, truth = synthetic.generate(vehicles, prices, priors, n_per_cohort=46, seed=11)
    assert truth.n_listings == 22 * 46 >= 1000
    report, fit = run_backtest(
        parse_listings_csv(synthetic.to_csv(rows), vehicles), vehicles, prices, priors, AS_OF
    )
    assert report.n_listings == truth.n_listings
    assert abs(report.overall.coverage - 0.80) < 0.08
    assert report.overall.mape < 0.12
    assert report.passes
    assert set(report.by_segment) == {"ev-mid", "ev-suv", "ev-small"}
    assert list(report.by_age_band) == ["<2y", "2-4y", "4y+"]
    assert sum(c.n for c in report.by_age_band.values()) == report.overall.n
    assert report.thin_cohorts == []


def test_gate_on_committed_fixture_and_rendered_report(seed_data):
    vehicles, prices, priors = seed_data
    assert FIXTURE_LISTINGS.exists(), "run scripts/cars_build_bundle.py --write-fixture"
    listings = parse_listings_csv(FIXTURE_LISTINGS.read_text(encoding="utf-8"), vehicles)
    as_of = max(x.snapshot_date for x in listings)
    report, fit = run_backtest(listings, vehicles, prices, priors, as_of)
    assert report.overall.wilson_high >= GATE_UPPER
    assert report.passes
    assert sum(1 for v in fit.params.variants.values() if v.cohorts) >= 4  # renders for >= 4 models
    md = render_backtest_markdown(report, fit.params, "the synthetic fixture")
    assert "**Gate: PASS**" in md
    assert "| ev-mid |" in md and "| <2y |" in md and "## Thin cohorts" in md
    assert BACKTEST_MD.exists(), "render with scripts/cars_build_bundle.py --synthetic --report"
    committed = BACKTEST_MD.read_text(encoding="utf-8")
    assert "**Gate: PASS**" in committed and "eb-v1" in committed


def test_gate_fails_only_when_upper_bound_below_seventy(seed_data):
    vehicles, prices, priors = seed_data
    rows, _ = synthetic.generate(vehicles, prices, priors, n_per_cohort=12, seed=4)
    listings = parse_listings_csv(synthetic.to_csv(rows), vehicles)
    report, fit = run_backtest(listings, vehicles, prices, priors, AS_OF)
    assert report.passes
    # Shrink every sigma_car by 5x: the 80 % interval covers far fewer listings
    for e in fit.estimates.values():
        e.sigma_car /= 5
    from app.cars.market.backtest import loo_predictions

    preds = loo_predictions(fit, AS_OF)
    cell = summarise(preds["ape"].to_numpy(float), preds["covered"].to_numpy(bool))
    assert cell.wilson_high < GATE_UPPER


def test_thin_cohorts_and_skipped_listed(seed_data):
    vehicles, prices, priors = seed_data
    rows, _ = synthetic.generate(vehicles, prices, priors, n_per_cohort=12, seed=4)
    listings = parse_listings_csv(synthetic.to_csv(rows), vehicles)
    kona = [x for x in listings if x.variant_id == "hyundai-kona-64"]
    one = sorted({x.listing_id for x in kona if x.model_year == 2019})[0]
    trimmed = [x for x in listings if x.variant_id != "hyundai-kona-64" or x.listing_id == one]
    report, fit = run_backtest(trimmed, vehicles, prices, priors, AS_OF)
    assert ("hyundai-kona-64:2019", 1) in report.thin_cohorts
    assert "hyundai-kona-64:2019" in report.skipped_cohorts
    md = render_backtest_markdown(report, fit.params, "trimmed synthetic data")
    assert "- `hyundai-kona-64:2019`: 1 listing(s)" in md
    assert "single listing" in md
