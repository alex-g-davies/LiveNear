"""Market model v1 (R7, R12): parameter recovery on synthetic data, shrinkage
rules, status rules, retention and bias stages."""

from __future__ import annotations

import math
from datetime import date, timedelta
from decimal import Decimal

import numpy as np
import pytest

from app.cars.data_bundle import parse_listings_csv
from app.cars.market import seeds, synthetic
from app.cars.market.fit import LIVE_N, fit_market, fit_market_model, fit_slope, robust_mean
from app.cars.market.predict import value_path
from app.cars.market.schema import (
    KM_OFFSET,
    ListingRow,
    age_years,
    latest_per_listing,
    listings_frame,
)

AS_OF = date(2026, 10, 31)


@pytest.fixture(scope="module")
def seed_data():
    vehicles = seeds.load_vehicles()
    prices = seeds.load_new_prices()
    priors = seeds.load_retention_priors(vehicles, prices)
    return vehicles, prices, priors


@pytest.fixture(scope="module")
def synthetic_fit(seed_data):
    vehicles, prices, priors = seed_data
    rows, truth = synthetic.generate(vehicles, prices, priors, n_per_cohort=12, seed=22)
    listings = parse_listings_csv(synthetic.to_csv(rows), vehicles)
    fit = fit_market(listings, vehicles, prices, priors, AS_OF)
    return fit, truth


def test_robust_helpers_degenerate_inputs():
    assert robust_mean(np.array([1.0])) == 1.0
    assert robust_mean(np.array([1.0, 3.0])) == 2.0
    assert robust_mean(np.array([2.0, 2.0, 2.0, 2.0])) == 2.0
    assert fit_slope(np.array([1.0, 2.0, 3.0]), np.array([0.0, 0.0, 0.0])) is None
    assert fit_slope(np.array([1.0, 2.0]), np.array([0.0, 1.0])) is None
    with pytest.raises(ValueError):
        robust_mean(np.array([]))


def test_recovers_cohort_levels_slope_sigma_and_dealer_premium(synthetic_fit, seed_data):
    fit, truth = synthetic_fit
    assert fit.params.version == "eb-v1"
    n_cohorts = sum(len(v.model_years) for v in seed_data[0])
    assert len(fit.estimates) == len(truth.cohorts) == n_cohorts
    errs = []
    for key, e in fit.estimates.items():
        tr = truth.cohorts[key]
        errs.append(e.alpha - tr.log_price(e.cohort.ref_km))  # truth at the fitted ref_km
        # beta is shrunk toward the segment slope; within 0.2 of the truth per cohort
        assert abs(e.beta - truth.beta) < 0.2
        assert 0.06 <= e.sigma_car <= 0.16
    errs = np.array(errs)
    assert abs(errs.mean()) < 0.02  # no systematic level bias
    assert np.abs(errs).max() < 0.10  # every cohort within 10 % at n = 12
    # Segment slopes: precision-weighted pooling of 15 ev-mid cohorts lands near -0.08
    assert abs(fit.segment_slopes["ev-mid"].beta_bar - truth.beta) < 0.04
    assert fit.delta_fitted
    assert abs(fit.delta - truth.dealer_premium) < 0.02
    assert abs(float(fit.params.dealer_premium.value) - truth.dealer_premium) < 0.02
    assert fit.params.dealer_premium.status == "live"
    # pooled scale: tight for ev-mid (204 listings), looser for the 2-3 cohort segments
    assert abs(fit.segment_sigma["ev-mid"] - truth.sigma_car) < 0.02
    for seg, sigma in fit.segment_sigma.items():
        assert abs(sigma - truth.sigma_car) < 0.04, seg


def test_recovery_tightens_with_more_listings(seed_data):
    vehicles, prices, priors = seed_data
    rows, truth = synthetic.generate(vehicles, prices, priors, n_per_cohort=60, seed=7)
    fit = fit_market(
        parse_listings_csv(synthetic.to_csv(rows), vehicles), vehicles, prices, priors, AS_OF
    )
    errs = np.array(
        [e.alpha - truth.cohorts[k].log_price(e.cohort.ref_km) for k, e in fit.estimates.items()]
    )
    assert np.abs(errs).max() < 0.05
    assert abs(fit.segment_slopes["ev-mid"].beta_bar - truth.beta) < 0.02
    for seg in fit.segment_slopes.values():  # 2-3 cohort segments: se of the slope ~ 0.026
        assert abs(seg.beta_bar - truth.beta) < 0.06
    # retention: the fitted ev-mid curve recovers the generating prior within tolerance.
    # c is tied to the pooled within-cohort slope and a absorbs its error, so compare
    # the curve at typical (age, km) points rather than the intercept alone.
    s, p = fit.params.segments["ev-mid"], priors.segments["ev-mid"]
    assert abs(s.b - p.b) < 0.02 and abs(s.c - p.c) < 0.02
    for age, km in ((1.0, 15_000), (3.0, 50_000), (5.0, 90_000)):
        lkm = math.log(km + KM_OFFSET)
        assert abs((s.a + s.b * age + s.c * lkm) - (p.a + p.b * age + p.c * lkm)) < 0.05
    assert abs(float(fit.params.ask_to_sale_discount.value) - 100 * truth.last_ask_discount) < 0.6


def test_retention_curve_and_shifts(synthetic_fit, seed_data):
    fit, _ = synthetic_fit
    _, _, priors = seed_data
    p = fit.params
    for seg in ("ev-mid", "ev-suv", "ev-small"):
        s = p.segments[seg]
        assert s.b < 0 and s.c < 0
        assert s.sigma_resid >= 0.05
        assert s.sigma_per_year == priors.segments[seg].sigma_per_year  # kept at the prior in v1
        assert s.beta_logkm == pytest.approx(fit.segment_slopes[seg].beta_bar)
    assert all(abs(v.shift) < 0.08 for v in p.variants.values())
    assert any(v.shift != 0 for v in p.variants.values())


def test_bias_stage_on_ten_snapshots(synthetic_fit, seed_data):
    fit, truth = synthetic_fit
    p = fit.params
    assert fit.n_snapshots == 10
    # ask-to-sale: median last/first ask on removed ads recovers the 2 % cut
    assert abs(float(p.ask_to_sale_discount.value) - 100 * truth.last_ask_discount) < 0.6
    assert p.ask_to_sale_discount.status == "estimate"  # 8 <= snapshots < 12 (spec R7)
    # drift: true 0; on 12 listings per cohort the point estimate is noisy, so only
    # the bootstrap range is checked there; with 36 per cohort the point estimate
    # itself lands within 10 % per year of zero.
    d = p.used_price_drift
    assert d.range is not None
    assert d.range.low <= 0 <= d.range.high
    vehicles, prices, priors = seed_data
    rows, _ = synthetic.generate(vehicles, prices, priors, n_per_cohort=36, seed=22)
    big = fit_market(
        parse_listings_csv(synthetic.to_csv(rows), vehicles), vehicles, prices, priors, AS_OF
    )
    d_big = big.params.used_price_drift
    assert d_big.range is not None and d_big.range.low <= 0 <= d_big.range.high
    assert abs(float(d_big.value)) < 10


def test_thin_cohorts_take_segment_slope_and_status_rules(seed_data):
    vehicles, prices, priors = seed_data
    rows, truth = synthetic.generate(vehicles, prices, priors, n_per_cohort=8, seed=3)
    listings = parse_listings_csv(synthetic.to_csv(rows), vehicles)
    # keep one listing for the first Kona cohort, two for the second, drop one whole variant
    by_cohort: dict[tuple[str, int], list] = {}
    for x in listings:
        by_cohort.setdefault((x.variant_id, x.model_year), []).append(x)
    kept = []
    for key, xs in by_cohort.items():
        ids = sorted({x.listing_id for x in xs})
        if key == ("hyundai-kona-64", 2019):
            keep_ids = set(ids[:1])
        elif key == ("hyundai-kona-64", 2020):
            keep_ids = set(ids[:2])
        elif key[0] in ("vw-id4-pro-rwd", "mg-mg4-64"):
            keep_ids = set()  # ev-small then has only the thin Kona cohorts
        else:
            keep_ids = set(ids)
        kept.extend(x for x in xs if x.listing_id in keep_ids)
    fit = fit_market(kept, vehicles, prices, priors, AS_OF)
    e1 = fit.estimates[("hyundai-kona-64", 2019)]
    e2 = fit.estimates[("hyundai-kona-64", 2020)]
    seg = fit.segment_slopes["ev-small"]
    assert e1.n == 1 and e2.n == 2
    assert e1.beta_hat is None and e2.beta_hat is None
    assert e1.beta == seg.beta_bar == e2.beta
    assert seg.from_prior and seg.beta_bar == priors.segments["ev-small"].beta_logkm
    assert e1.status == "estimate" and e2.status == "estimate"
    assert math.isfinite(e1.alpha) and e1.se_alpha > e2.se_alpha
    params = fit.params
    assert params.variants["vw-id4-pro-rwd"].cohorts == {}
    assert params.variants["mg-mg4-64"].cohorts == {}
    assert params.variants["hyundai-kona-64"].cohorts[2019].status == "estimate"
    assert params.variants["tesla-model3-rwd"].cohorts[2021].status == "live"
    assert params.status == "live"  # >= 4 variants still have a cohort with n >= 5
    # the engine consumes the result: a path for a thin cohort is an estimate
    path = value_path(params, "hyundai-kona-64", 2019, 87, 150_000, 15_000)
    assert path.source.status == "estimate" and "1 listings" in (path.source.basis or "")


def test_model_is_estimate_until_four_variants_have_live_cohorts(seed_data):
    vehicles, prices, priors = seed_data
    rows, _ = synthetic.generate(vehicles, prices, priors, n_per_cohort=LIVE_N - 1, seed=5)
    params = fit_market_model(
        parse_listings_csv(synthetic.to_csv(rows), vehicles), vehicles, prices, priors, AS_OF
    )
    assert params.status == "estimate"
    assert "needed for a live model" in params.note
    assert all(c.status == "estimate" for v in params.variants.values() for c in v.cohorts.values())
    # fewer than 20 dealer rows per side still exist here, so delta is fitted; but with
    # a dealer-only market it must fall back to the prior
    rows_d, _ = synthetic.generate(
        vehicles, prices, priors, n_per_cohort=6, seed=5, dealer_share=1.0
    )
    p2 = fit_market_model(
        parse_listings_csv(synthetic.to_csv(rows_d), vehicles), vehicles, prices, priors, AS_OF
    )
    assert p2.dealer_premium == priors.dealer_premium
    assert "dealer premium kept at the prior" in p2.note


def test_no_listings_returns_priors_shape(seed_data):
    vehicles, prices, priors = seed_data
    params = fit_market_model([], vehicles, prices, priors, AS_OF)
    assert params.status == "estimate" and params.version == "eb-v1"
    assert all(v.cohorts == {} for v in params.variants.values())
    assert params.segments["ev-mid"].a == priors.segments["ev-mid"].a
    assert params.used_price_drift == priors.used_price_drift


def test_bias_priors_kept_below_eight_snapshots(seed_data):
    vehicles, prices, priors = seed_data
    rows, _ = synthetic.generate(vehicles, prices, priors, n_per_cohort=12, weeks=5, seed=9)
    params = fit_market_model(
        parse_listings_csv(synthetic.to_csv(rows), vehicles), vehicles, prices, priors, AS_OF
    )
    assert params.used_price_drift == priors.used_price_drift
    assert params.ask_to_sale_discount == priors.ask_to_sale_discount
    assert "5 weekly snapshot(s) < 8" in params.note


def test_latest_per_listing_prefers_listed_row():
    d0 = date(2026, 10, 1)
    rows = [
        ListingRow("a", "v", 2022, d0, 100_000_00, 10_000, status="listed"),
        ListingRow("a", "v", 2022, d0 + timedelta(days=7), 90_000_00, 10_000, status="removed"),
        ListingRow("b", "v", 2022, d0, 100_000_00, 10_000, status="removed"),
    ]
    latest = latest_per_listing(listings_frame(rows))
    by_id = {r.listing_id: r for r in latest.itertuples()}
    assert by_id["a"].ask_ore == 100_000_00 and by_id["a"].status == "listed"
    assert by_id["b"].status == "removed"
    assert age_years(2024, date(2026, 7, 1)) == pytest.approx(2.0, abs=0.01)


def test_synthetic_fixture_has_no_identifiers(seed_data):
    vehicles, prices, priors = seed_data
    rows, truth = synthetic.generate(vehicles, prices, priors)
    assert truth.n_listings == sum(len(v.model_years) for v in vehicles) * 12
    assert all(r["reg_number"] == "" for r in rows)
    assert all(r["ad_id_or_url"].startswith("fx-") for r in rows)
    assert Decimal(rows[0]["asking_price_nok"]) > 0
