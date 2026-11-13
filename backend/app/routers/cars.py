"""Cars endpoints (spec 022 R10): vehicles, market cohorts, listings, stateless
scenario runs and source health.

Nothing here stores anything per user: the profile arrives in the request
and leaves in the response. Scenario results are memoised in a small
in-process LRU keyed by the request hash so slider churn does not recompute
identical runs; the cache holds no identity.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from datetime import UTC, date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from ..bounded_cache import BoundedCache
from ..cars import data_bundle
from ..cars.bundle_schema import ListingsMode
from ..cars.data_bundle import Bundle, BundleError, Listing
from ..cars.engine.overrides import WhatIf, apply_input_overrides, apply_what_if
from ..cars.engine.run import run_scenario
from ..cars.rules import load_tax_rules, pending_rules
from ..cars.scenario_builder import build_scenario
from ..cars.schemas import (
    CohortOut,
    CohortsResponse,
    ListingOut,
    ListingsResponse,
    MarketPoint,
    MarketPointsResponse,
    OptionSummary,
    RecommendRequest,
    RecommendResponse,
    RecommendRow,
    ScenarioRequest,
    ScenarioResponse,
    SelectionItem,
    SourcesResponse,
    VehicleOut,
)
from ..config import Settings, get_settings
from ..ratelimit import DATA_LIMIT, limiter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/cars", tags=["cars"])

SCENARIO_LIMIT = os.getenv("CARS_SCENARIO_LIMIT", "30/minute")
_SCENARIO_CACHE: BoundedCache[str, ScenarioResponse] = BoundedCache(256)
_RECOMMEND_CACHE: BoundedCache[str, RecommendResponse] = BoundedCache(64)

# Keys the browser may put in `overrides` to persist Curves-view assumptions
# that have no Profile field (the frontend's "Save as my assumptions").
_WHAT_IF_OVERRIDE_KEYS = {
    "loan_rate": "loan_rate_pct",
    "used_price_drift_pct": "used_price_drift_pct",
}


def clear_cache() -> None:
    _SCENARIO_CACHE.clear()
    _RECOMMEND_CACHE.clear()


def _bundle(cfg: Settings) -> Bundle:
    try:
        return data_bundle.get_bundle(production=bool(cfg.static_dir.strip()))
    except BundleError as exc:
        raise HTTPException(status_code=503, detail=f"cars data unavailable: {exc}") from None


def _today() -> date:
    return datetime.now(UTC).date()


@router.get("/vehicles", response_model=list[VehicleOut])
@limiter.limit(DATA_LIMIT)
def vehicles(request: Request, cfg: Settings = Depends(get_settings)) -> list[VehicleOut]:
    b = _bundle(cfg)
    out: list[VehicleOut] = []
    for v in b.vehicles:
        newest = max(v.model_years)
        price = b.new_price(v.variant_id, newest)
        out.append(
            VehicleOut(
                variant_id=v.variant_id,
                make=v.make,
                model=v.model,
                trim_group=v.trim_group,
                segment=v.segment,
                model_years=list(v.model_years),
                energy_type=v.energy_type,
                drive=v.drive,
                body=v.body,
                battery_kwh=v.battery_kwh,
                power_kw=v.power_kw,
                heat_pump=v.heat_pump,
                auto_precondition=v.auto_precondition,
                range_km_wltp=v.range_km_wltp,
                accel_0_100_s=v.accel_0_100_s,
                fun_score=v.fun_score.value,
                new_price_ore=price.price_ore.value if price else None,
                has_lease_offer=bool(b.lease_offers_for(v.variant_id)),
            )
        )
    return out


def _meets(v, must_haves: list[str]) -> bool:
    return all(
        (m == "heat_pump" and v.heat_pump)
        or (m == "auto_precondition" and v.auto_precondition)
        or (m == "awd" and v.drive == "awd")
        for m in must_haves
    )


@router.get("/market/cohorts", response_model=CohortsResponse)
@limiter.limit(DATA_LIMIT)
def cohorts(
    request: Request,
    cfg: Settings = Depends(get_settings),
    make: str | None = Query(default=None),
    year_from: int = Query(default=2010, ge=2010, le=2030),
    year_to: int = Query(default=2030, ge=2010, le=2030),
    max_price_nok: int | None = Query(default=None, ge=0),
    energy_type: list[str] | None = Query(default=None),
    must_have: list[str] | None = Query(default=None),
) -> CohortsResponse:
    b = _bundle(cfg)
    out: list[CohortOut] = []
    by_id = {v.variant_id: v for v in b.vehicles}
    for c in b.cohorts:
        v = by_id[c.variant_id]
        if make and v.make.lower() != make.lower():
            continue
        if not (year_from <= c.model_year <= year_to):
            continue
        if max_price_nok is not None and c.value_ref_ore > max_price_nok * 100:
            continue
        if energy_type and v.energy_type not in energy_type:
            continue
        out.append(
            CohortOut(
                cohort_id=c.cohort_id,
                variant_id=c.variant_id,
                make=v.make,
                model=v.model,
                trim_group=v.trim_group,
                model_year=c.model_year,
                energy_type=v.energy_type,
                drive=v.drive,
                body=v.body,
                n_listings=c.n_listings,
                ref_km=c.ref_km,
                value_ref_ore=c.value_ref_ore,
                pi_low_ore=c.pi_low_ore,
                pi_high_ore=c.pi_high_ore,
                status=c.status,
                as_of=c.as_of,
                range_km_wltp=v.range_km_wltp,
                efficiency_wh_per_km=v.efficiency_wh_per_km.value
                if v.efficiency_wh_per_km
                else None,
                fuel=v.fuel,
                fuel_l_per_100km=v.fuel_l_per_100km.value if v.fuel_l_per_100km else None,
                accel_0_100_s=v.accel_0_100_s,
                meets_must_haves=_meets(v, must_have or []),
            )
        )
    return CohortsResponse(
        bundle_as_of=b.meta.bundle_as_of,
        listings_mode=b.listings_mode,
        n_listings_total=len(b.listings),
        cohorts=out,
    )


@router.get("/market/cohorts/{cohort_id}/listings", response_model=ListingsResponse)
@limiter.limit(DATA_LIMIT)
def listings(
    request: Request, cohort_id: str, cfg: Settings = Depends(get_settings)
) -> ListingsResponse:
    b = _bundle(cfg)
    if b.cohort(cohort_id) is None:
        raise HTTPException(status_code=404, detail="unknown cohort")
    mode: ListingsMode = b.listings_mode
    if mode == "unavailable":
        raise HTTPException(
            status_code=503, detail="listings unavailable (no R2 credentials configured)"
        )
    rows = [
        ListingOut(
            listing_id=x.listing_id,
            snapshot_date=x.snapshot_date,
            ask_ore=x.ask_ore,
            km=x.km,
            model_year=x.model_year,
            seller_type=x.seller_type,
            first_reg_month=x.first_reg_month,
            status=x.status,
        )
        for x in b.listings_for(cohort_id)
    ]
    return ListingsResponse(cohort_id=cohort_id, listings_mode=mode, listings=rows)


@router.get("/market/points", response_model=MarketPointsResponse)
@limiter.limit(DATA_LIMIT)
def market_points(
    request: Request,
    cfg: Settings = Depends(get_settings),
    make: str | None = Query(default=None),
    year_from: int = Query(default=2010, ge=2010, le=2030),
    year_to: int = Query(default=2030, ge=2010, le=2030),
    max_price_nok: int | None = Query(default=None, ge=0),
    energy_type: list[str] | None = Query(default=None),
    must_have: list[str] | None = Query(default=None),
) -> MarketPointsResponse:
    """One dot per listing for the market map (spec 023 R1): the latest
    snapshot of each listing, kept only while it is still `listed`. Same
    filters as /market/cohorts; here `must_have` filters rows out. In
    `unavailable` mode the list is empty (the screen falls back to cohort
    points), never a 503."""
    b = _bundle(cfg)
    by_id = {v.variant_id: v for v in b.vehicles}
    latest: dict[str, Listing] = {}
    for x in b.listings:
        cur = latest.get(x.listing_id)
        if cur is None or x.snapshot_date > cur.snapshot_date:
            latest[x.listing_id] = x
    out: list[MarketPoint] = []
    for x in latest.values():
        if x.status != "listed":
            continue
        v = by_id.get(x.variant_id)
        if v is None:
            continue
        if make and v.make.lower() != make.lower():
            continue
        if not (year_from <= x.model_year <= year_to):
            continue
        if max_price_nok is not None and x.ask_ore > max_price_nok * 100:
            continue
        if energy_type and v.energy_type not in energy_type:
            continue
        if must_have and not _meets(v, must_have):
            continue
        out.append(
            MarketPoint(
                listing_id=x.listing_id,
                variant_id=x.variant_id,
                cohort_id=f"{x.variant_id}:{x.model_year}",
                model_year=x.model_year,
                ask_ore=x.ask_ore,
                km=x.km,
                seller_type=x.seller_type,
                first_reg_month=x.first_reg_month,
                snapshot_date=x.snapshot_date,
            )
        )
    out.sort(key=lambda p: (p.variant_id, p.model_year, p.listing_id))
    return MarketPointsResponse(
        bundle_as_of=b.meta.bundle_as_of,
        listings_mode=b.listings_mode,
        n_points=len(out),
        points=out,
    )


def _request_key(req: BaseModel, start: date, bundle_as_of: date) -> str:
    raw = json.dumps(
        {"r": req.model_dump(mode="json"), "s": start.isoformat(), "b": bundle_as_of.isoformat()},
        sort_keys=True,
    )
    return hashlib.sha256(raw.encode()).hexdigest()


@router.post("/scenarios", response_model=ScenarioResponse)
@limiter.limit(SCENARIO_LIMIT)
def scenarios(
    request: Request, body: ScenarioRequest, cfg: Settings = Depends(get_settings)
) -> ScenarioResponse:
    b = _bundle(cfg)
    start = body.profile.start_date or _today()
    key = _request_key(body, start, b.meta.bundle_as_of)
    cached = _SCENARIO_CACHE.get(key)
    if cached is not None:
        return cached
    t0 = time.perf_counter()
    rules = load_tax_rules()
    try:
        sc, notes, meta = build_scenario(
            b, body.profile, body.selection, rules, start, seed=body.seed, draws=body.draws
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None

    overrides = dict(body.overrides)
    what_if = body.what_if.model_dump(exclude_none=True) if body.what_if else {}
    for key_in, field in _WHAT_IF_OVERRIDE_KEYS.items():
        if key_in in overrides and field not in what_if:
            try:
                what_if[field] = Decimal(str(overrides.pop(key_in)))
            except ArithmeticError:
                overrides.pop(key_in, None)
    if what_if:
        sc = apply_what_if(sc, WhatIf(**what_if), start)
    if overrides:
        try:
            sc = apply_input_overrides(sc, overrides, start)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"bad override: {exc}") from None

    res = run_scenario(sc, body.measure)
    options = []
    for o in res.options:
        m = meta.get(o.option_id.removesuffix(":cash"), {})
        options.append(
            OptionSummary(
                result=o,
                variant_id=m.get("variant_id", ""),
                option_kind=m.get("kind", o.mode),
                seller_type=m.get("seller"),
                lease_offer_id=m.get("offer"),
            )
        )
    resp = ScenarioResponse(
        ranking_measure=body.measure,
        exit_odds=res.exit_odds,
        seed=res.seed,
        draws=res.draws,
        bundle_as_of=b.meta.bundle_as_of,
        start_date=start,
        options=options,
        ruled_out=res.ruled_out,
        skipped=notes,
        sensitivity=res.sensitivity,
        sensitivity_option_id=res.sensitivity_option_id,
        elapsed_ms=int((time.perf_counter() - t0) * 1000),
    )
    _SCENARIO_CACHE[key] = resp
    return resp


REASON_LOWEST = "lowest expected cost"
REASON_NARROWEST = "narrowest uncertainty band"
REASON_FUN = "best fun score"
REASON_CASH = "lowest cash up front"


def _reasons(options, measure: str) -> dict[str, list[str]]:
    """Tags per option id (024 R11): rank 1, narrowest P10-P90 band of the
    expected measure, best fun score, lowest cash up front. Ties go to the
    better-ranked option, so every tag names exactly one row."""
    out: dict[str, list[str]] = {o.option_id: [] for o in options}
    if not options:
        return out
    out[options[0].option_id].append(REASON_LOWEST)
    narrow = min(
        options, key=lambda o: o.measures[measure].expected.p90 - o.measures[measure].expected.p10
    )
    out[narrow.option_id].append(REASON_NARROWEST)
    fun = max(options, key=lambda o: Decimal(o.fun_score))
    out[fun.option_id].append(REASON_FUN)
    cash = min(options, key=lambda o: o.cash_up_front)
    out[cash.option_id].append(REASON_CASH)
    return out


@router.post("/recommend", response_model=RecommendResponse)
@limiter.limit(SCENARIO_LIMIT)
def recommend(
    request: Request, body: RecommendRequest, cfg: Settings = Depends(get_settings)
) -> RecommendResponse:
    """Rank every option the catalogue and the profile's limits allow (024 R11)."""
    b = _bundle(cfg)
    start = body.profile.start_date or _today()
    key = _request_key(body, start, b.meta.bundle_as_of)
    cached = _RECOMMEND_CACHE.get(key)
    if cached is not None:
        return cached
    t0 = time.perf_counter()
    selection = [
        SelectionItem(
            variant_id=v.variant_id, year_from=min(v.model_years), year_to=max(v.model_years)
        )
        for v in b.vehicles
    ]
    try:
        sc, notes, meta = build_scenario(
            b, body.profile, selection, load_tax_rules(), start, seed=body.seed, draws=body.draws
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    res = run_scenario(sc, body.measure)
    reasons = _reasons(res.options, body.measure)
    ruled: dict[str, int] = {}
    for r in res.ruled_out:
        for reason in r.reasons:
            ruled[reason] = ruled.get(reason, 0) + 1
    picked = [o for o in res.options[: body.n]]
    for o in res.options[body.n :]:
        if reasons[o.option_id]:
            picked.append(o)  # a tag holder outside the top n still shows
    rank_of = {o.option_id: i + 1 for i, o in enumerate(res.options)}
    rows = []
    for o in picked:
        m = meta.get(o.option_id.removesuffix(":cash"), {})
        rows.append(
            RecommendRow(
                rank=rank_of[o.option_id],
                reasons=reasons[o.option_id],
                summary=OptionSummary(
                    result=o,
                    variant_id=m.get("variant_id", ""),
                    option_kind=m.get("kind", o.mode),
                    seller_type=m.get("seller"),
                    lease_offer_id=m.get("offer"),
                ),
            )
        )
    resp = RecommendResponse(
        ranking_measure=body.measure,
        bundle_as_of=b.meta.bundle_as_of,
        start_date=start,
        n_considered=len(res.options),
        ruled_out=ruled,
        skipped=len(notes),
        rows=rows,
        elapsed_ms=int((time.perf_counter() - t0) * 1000),
    )
    _RECOMMEND_CACHE[key] = resp
    return resp


@router.get("/sources", response_model=SourcesResponse)
@limiter.limit(DATA_LIMIT)
def sources(request: Request, cfg: Settings = Depends(get_settings)) -> SourcesResponse:
    b = _bundle(cfg)
    rules = load_tax_rules()
    return SourcesResponse(
        bundle_as_of=b.meta.bundle_as_of,
        listings_mode=b.listings_mode,
        sources=b.meta.sources,
        pending_rules=pending_rules(),
        unverified_rules=[r.id for r in rules.rules if r.status != "live"],
    )
