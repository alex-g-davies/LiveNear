"""Resale path for one car from the fitted market model (spec 022 R7, R4).

    log r(age, km) = a_s + b_s·age_years + c_s·log(km + KM_OFFSET) + shift_m

Given a car bought at age `age0` with `km0` on the clock and driven
`km_per_year`, the P50 value at month t is the car's anchor value scaled by
the retention ratio:

    V(t) = V_0 · exp( log r(age0 + t, km(t)) − log r(age0, km0) )

where V_0 is the cohort's fitted asking value at km0 (if a cohort fit exists)
or the retention model's own level (`new_price · r`) when it does not. The
ask→sale discount is applied to every value the user would *receive*.

Single-car log-sigma grows with the horizon:
    σ(t)² = σ_car² + (σ_per_year · t/12)²
"""

from __future__ import annotations

import math
from datetime import date
from decimal import Decimal

from ..bundle_schema import MarketModelParams
from ..engine.models import MONTHS, In, ResalePath
from .constants import KM_OFFSET


def _log_r(seg, shift: float, age_years: float, km: float) -> float:
    return seg.a + seg.b * age_years + seg.c * math.log(km + KM_OFFSET) + shift


def anchor_value(
    params: MarketModelParams,
    variant_id: str,
    model_year: int,
    age0_months: int,
    km0: int,
    dealer: bool,
) -> tuple[int, str, float]:
    """Current P50 asking value in øre for this car, its status and σ_car."""
    v = params.variants[variant_id]
    seg = params.segments[v.segment]
    fit = v.cohorts.get(model_year)
    if fit is not None:
        log_value = fit.alpha + fit.beta * (
            math.log(km0 + KM_OFFSET) - math.log(fit.ref_km + KM_OFFSET)
        )
        status = fit.status
        sigma_car = fit.sigma_car
    else:
        new_price = v.new_price_by_year.get(model_year) or max(v.new_price_by_year.values())
        # Capped at the new price: the segment curve is fitted on used cohorts
        # and can exceed r = 1 when extrapolated to a nearly new, low-km car.
        log_value = min(
            math.log(new_price) + _log_r(seg, v.shift, age0_months / 12.0, km0),
            math.log(new_price),
        )
        status = "estimate"
        sigma_car = math.hypot(seg.sigma_resid, 0.10)
    if dealer:
        log_value += float(params.dealer_premium.value)
    return int(round(math.exp(log_value))), status, sigma_car


def value_path(
    params: MarketModelParams,
    variant_id: str,
    model_year: int,
    age0_months: int,
    km0: int,
    km_per_year: int,
    anchor_ore: int | None = None,
    as_of: date | None = None,
) -> ResalePath:
    """P50 øre and log-sigma for months 0..60. `anchor_ore` overrides the
    cohort value at month 0 (e.g. the actual price paid) so the path starts
    where the user starts; resale is always a private-sale level, so no dealer
    premium is applied to future values."""
    v = params.variants[variant_id]
    seg = params.segments[v.segment]
    v0, status, sigma_car = anchor_value(
        params, variant_id, model_year, age0_months, km0, dealer=False
    )
    v0 = anchor_ore if anchor_ore is not None else v0
    discount = 1.0 - float(params.ask_to_sale_discount.value) / 100.0
    base = _log_r(seg, v.shift, age0_months / 12.0, km0)
    p50 = []
    sig = []
    for t in range(MONTHS):
        age = (age0_months + t) / 12.0
        km = km0 + km_per_year * t / 12.0
        ratio = math.exp(_log_r(seg, v.shift, age, km) - base)
        value = v0 * ratio * (discount if t > 0 else 1.0)
        p50.append(max(0, int(round(value))))
        sig.append(math.sqrt(sigma_car**2 + (seg.sigma_per_year * t / 12.0) ** 2))
    overall = "estimate" if status == "estimate" or params.status == "estimate" else "live"
    fit = v.cohorts.get(model_year)
    basis = None
    if overall == "estimate":
        basis = (
            f"cohort {variant_id}:{model_year} has {fit.n} listings (< 5)"
            if fit is not None and fit.n < 5
            else "no cohort fit; value from the segment retention curve"
            if fit is None
            else params.note or "market model marked estimate"
        )
    return ResalePath(
        p50_ore=tuple(p50),
        log_sigma=tuple(sig),
        source=In[str](
            id=f"market.{variant_id}.{model_year}.resale_path",
            value=f"{params.version} retention path, cohort n={fit.n if fit else 0}",
            source=f"Market model {params.version}",
            as_of=as_of or params.as_of,
            status=overall,
            basis=basis,
        ),
    )


def cohort_value_at_km(
    params: MarketModelParams, variant_id: str, model_year: int, km: int
) -> int | None:
    """Asking value (øre) at a given km for the market map's km axis."""
    fit = params.variants[variant_id].cohorts.get(model_year)
    if fit is None:
        return None
    return int(
        round(
            math.exp(
                fit.alpha + fit.beta * (math.log(km + KM_OFFSET) - math.log(fit.ref_km + KM_OFFSET))
            )
        )
    )


def drift_decimal(params: MarketModelParams) -> Decimal:
    return params.used_price_drift.value
