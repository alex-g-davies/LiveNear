"""Result shapes and the per-option assembly (spec 022 R3–R5, R10).

These Pydantic models are what the API returns, so field names are stable.
All amounts are integer øre.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import numpy as np
from pydantic import BaseModel

from .measures import MEASURES, Deterministic, best_worst, deterministic_measures, expected
from .models import EXIT_POINTS, MONTHS, Lease, Option, Scenario, Used
from .montecarlo import Simulation, expected_draws, percentiles, simulate
from .schedule import ITEM_LABELS, Schedule, build_schedule

DISPLAY_LABELS = {
    "value_lost": "Value lost",
    "financing": "Financing",
    "lease_payments": "Lease payments",
    "insurance": "Insurance",
    "fees_and_taxes": "Fees and taxes",
    "energy": "Energy",
    "tyres": "Tyres",
    "service": "Service",
    "exit_costs": "Cost to exit",
    "delay": "Delay cost",
    "opportunity_cost": "Opportunity cost",
}


class Band(BaseModel):
    p10: list[int]
    p50: list[int]
    p90: list[int]


class Expected(BaseModel):
    p10: int
    p50: int
    p90: int


class ExitPoint(BaseModel):
    month: int
    value: int


class MeasureResult(BaseModel):
    band: Band
    deterministic: list[int]
    expected: Expected  # percentiles of the per-draw expected value
    expected_det: int  # Σ p(t)·deterministic(t)
    best: ExitPoint
    worst: ExitPoint


class InputView(BaseModel):
    id: str
    value: str
    source: str
    as_of: date
    status: str
    basis: str | None
    range: tuple[str, str] | None
    used_by: list[str]
    share_of_tco: float
    material: bool


class LineItemView(BaseModel):
    key: str
    label: str
    group: str
    estimate: bool
    used: list[str]
    at_exit: dict[int, int]  # cash: cumulative to t; exit: due at t


class DisplayItem(BaseModel):
    key: str
    label: str
    ore: int


class OptionResult(BaseModel):
    option_id: str
    label: str
    mode: str
    make: str
    model: str
    trim_group: str
    model_year: int
    fun_score: str
    status: str  # "live" | "estimate"
    material_estimates: list[str]
    cash_up_front: int
    km_at: list[int]
    measures: dict[str, MeasureResult]
    line_items: list[LineItemView]
    display: dict[int, list[DisplayItem]]
    inputs: list[InputView]
    resale_p50: list[int] | None


def _display_at(s: Schedule, det: Deterministic, t: int) -> list[DisplayItem]:
    it = s.items
    cum = lambda key: sum(it[key].ore[: t + 1]) if key in it else 0  # noqa: E731
    at = lambda key: it[key].ore[t] if key in it else 0  # noqa: E731
    deal = s.option.deal
    rows: list[tuple[str, int]] = []
    if isinstance(deal, Lease):
        rows.append(("lease_payments", cum("lease_payments")))
        exit_costs = at("early_exit") + at("excess_km") + at("exit_friction")
    else:
        price = s.option.deal.price_ore.value  # type: ignore[union-attr]
        value_back = -at("resale_value")
        rows.append(("value_lost", price - value_back + at("exit_friction")))
        financing = cum("loan_payments") + at("loan_payoff") - s.bases.loan_principal
        rows.append(("financing", financing))
        exit_costs = 0
    rows.append(("insurance", cum("insurance")))
    rows.append(("fees_and_taxes", cum("fees") + cum("re_registration") + cum("traffic_tax")))
    rows.append(("energy", cum("energy")))
    rows.append(("tyres", cum("tyres")))
    rows.append(("service", cum("service")))
    rows.append(("exit_costs", exit_costs))
    rows.append(("delay", cum("delay")))
    rows.append(("opportunity_cost", det.opportunity[t]))
    return [DisplayItem(key=k, label=DISPLAY_LABELS[k], ore=v) for k, v in rows]


def build_option_result(
    sc: Scenario, option: Option, draws: int | None = None
) -> tuple[OptionResult, Schedule, Deterministic, Simulation]:
    s = build_schedule(sc.user, sc.market, option)
    det = deterministic_measures(s, sc.user.return_on_cash_pct)
    sim = simulate(s, sc.user.return_on_cash_pct, draws or sc.draws, sc.seed)
    odds = sc.user.exit_odds.as_dict()

    measures: dict[str, MeasureResult] = {}
    for name in MEASURES:
        arr = sim.measure(name)
        p10, p50, p90 = percentiles(arr)
        e10, e50, e90 = (
            int(v) for v in np.rint(np.percentile(expected_draws(arr, odds), [10, 50, 90]))
        )
        detv = det.measure(name)
        best, worst = best_worst(detv, odds)
        measures[name] = MeasureResult(
            band=Band(p10=p10, p50=p50, p90=p90),
            deterministic=detv,
            expected=Expected(p10=e10, p50=e50, p90=e90),
            expected_det=expected(detv, odds),
            best=ExitPoint(month=best[0], value=best[1]),
            worst=ExitPoint(month=worst[0], value=worst[1]),
        )

    # --- line items at the exit points, and materiality of each input --------
    line_items: list[LineItemView] = []
    item_expected: dict[str, int] = {}
    for key, it in s.items.items():
        at_exit: dict[int, int] = {}
        series = []
        run = 0
        for t in range(MONTHS):
            if it.group == "cash":
                run += it.ore[t]
                series.append(run)
            else:
                series.append(it.ore[t])
        for t in EXIT_POINTS:
            at_exit[t] = series[t]
        item_expected[key] = expected(series, odds)
        line_items.append(
            LineItemView(
                key=key,
                label=ITEM_LABELS.get(key, key),
                group=it.group,
                estimate=it.estimate,
                used=sorted(it.used),
                at_exit=at_exit,
            )
        )
    tco_expected = max(1, abs(expected(det.tco, odds)))
    threshold = float(sc.market.materiality_threshold.value)
    material_estimates: list[str] = []
    inputs: list[InputView] = []
    for rec in s.ctx.records.values():
        used_by = sorted(s.ctx.used_by.get(rec.id, set()))
        share = sum(abs(item_expected.get(k, 0)) for k in used_by) / tco_expected
        material = share >= threshold
        if material and rec.status == "estimate":
            material_estimates.append(rec.id)
        inputs.append(
            InputView(
                id=rec.id,
                value=_fmt(rec.value),
                source=rec.source,
                as_of=rec.as_of,
                status=rec.status,
                basis=rec.basis,
                range=(str(rec.range.low), str(rec.range.high)) if rec.range else None,
                used_by=used_by,
                share_of_tco=round(share, 4),
                material=material,
            )
        )
    # Items flagged estimate by structure (repeat lease, carried rule) count too.
    for key, it in s.items.items():
        if it.estimate and abs(item_expected.get(key, 0)) / tco_expected >= threshold:
            if not any(
                s.ctx.records.get(i) and s.ctx.records[i].status == "estimate" for i in it.used
            ):
                material_estimates.append(f"item:{key}")
    inputs.sort(key=lambda v: (-v.share_of_tco, v.id))

    deal = option.deal
    result = OptionResult(
        option_id=option.id,
        label=option.label,
        mode=deal.mode,
        make=option.vehicle.make,
        model=option.vehicle.model,
        trim_group=option.vehicle.trim_group,
        model_year=option.vehicle.model_year,
        fun_score=str(option.vehicle.fun_score.value),
        status="estimate" if material_estimates else "live",
        material_estimates=sorted(set(material_estimates)),
        cash_up_front=det.cash_up_front,
        km_at=s.km_at,
        measures=measures,
        line_items=line_items,
        display={t: _display_at(s, det, t) for t in EXIT_POINTS},
        inputs=inputs,
        resale_p50=list(option.resale.p50_ore) if option.resale else None,
    )
    return result, s, det, sim


def _fmt(v: object) -> str:
    if isinstance(v, Decimal):
        return format(v.normalize(), "f")
    if isinstance(v, dict):
        return ", ".join(f"{k}={_fmt(x)}" for k, x in v.items())
    return str(v)


def purchase_price_of(option: Option) -> int | None:
    deal = option.deal
    if isinstance(deal, Lease):
        return None
    assert isinstance(deal, Used) or deal.mode == "new"
    return deal.price_ore.value
