"""Run a scenario: filters, per-option results, ranking, sensitivity (R3–R5, R10)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import numpy as np
from pydantic import BaseModel

from .calendar import add_months
from .measures import MEASURES, expected
from .models import Lease, Option, Scenario
from .montecarlo import Z80, Forced, expected_draws, simulate
from .result import OptionResult, build_option_result


class RuledOut(BaseModel):
    option_id: str
    label: str
    reasons: list[str]


class SensitivityRow(BaseModel):
    driver: str
    label: str
    low: int  # change in the expected measure when the driver sits at its P10
    high: int  # ... at its P90
    note: str = ""


class ScenarioResult(BaseModel):
    ranking_measure: str
    exit_odds: dict[int, int]
    seed: int
    draws: int
    options: list[OptionResult]  # ranked best first by expected P50 of ranking_measure
    ruled_out: list[RuledOut]
    sensitivity: list[SensitivityRow]
    sensitivity_option_id: str | None


def apply_limits(sc: Scenario, option: Option) -> list[str]:
    """Reasons an option is excluded by the user's hard limits (R11)."""
    lim = sc.user.limits
    reasons: list[str] = []
    deal = option.deal
    veh = option.vehicle
    if deal.mode not in lim.modes:
        reasons.append("way to get a car not selected")
    if lim.max_price_ore is not None and not isinstance(deal, Lease):
        if deal.price_ore.value > lim.max_price_ore:
            reasons.append("over your max price")
    if lim.need_by is not None:
        ready = add_months(sc.user.start_date, int(deal.delivery_months.value))
        if ready > lim.need_by:
            reasons.append(f"not available until {ready.isoformat()}")
    for need in lim.must_haves:
        if need == "heat_pump" and not veh.heat_pump:
            reasons.append("no heat pump")
        elif need == "auto_precondition" and not veh.auto_precondition:
            reasons.append("no automatic battery preconditioning")
        elif need == "awd" and veh.drive != "awd":
            reasons.append("not AWD")
    return reasons


def run_scenario(sc: Scenario, ranking_measure: str = "per_month") -> ScenarioResult:
    if ranking_measure not in MEASURES:
        raise ValueError(f"unknown measure {ranking_measure!r}")
    odds = sc.user.exit_odds.as_dict()
    results: list[OptionResult] = []
    schedules = {}
    ruled: list[RuledOut] = []
    for opt in sc.options:
        reasons = apply_limits(sc, opt)
        if reasons:
            ruled.append(RuledOut(option_id=opt.id, label=opt.label, reasons=reasons))
            continue
        res, s, _det, _sim = build_option_result(sc, opt)
        results.append(res)
        schedules[opt.id] = s
    results.sort(key=lambda r: (r.measures[ranking_measure].expected.p50, r.option_id))

    sensitivity: list[SensitivityRow] = []
    top_id = results[0].option_id if results else None
    if top_id is not None:
        s = schedules[top_id]
        r = sc.user.return_on_cash_pct

        def pinned(**kw: float) -> int:
            base = {
                "insurance_z": 0.0,
                "loan_rate_z": 0.0,
                "price_z": 0.0,
                "resale_z": 0.0,
                "drift_z": 0.0,
            }
            base.update(kw)
            sim = simulate(s, r, 1, sc.seed, Forced(**base))
            return int(np.rint(expected_draws(sim.measure(ranking_measure), odds)[0]))

        baseline = pinned()
        drivers = [
            ("resale", "Resale value", "resale_z", not isinstance(s.option.deal, Lease)),
            ("insurance", "Insurance", "insurance_z", s.bases.insurance_range is not None),
            ("loan_rate", "Loan rate", "loan_rate_z", s.bases.loan_principal > 0),
            ("charging", "Charging prices", "price_z", True),
        ]
        for key, label, field, applies in drivers:
            if not applies:
                continue
            lo = pinned(**{field: -Z80}) - baseline
            hi = pinned(**{field: Z80}) - baseline
            sensitivity.append(SensitivityRow(driver=key, label=label, low=lo, high=hi))
        det = results[0].measures[ranking_measure]
        exp = det.expected_det
        sensitivity.insert(
            1 if sensitivity else 0,
            SensitivityRow(
                driver="exit_timing",
                label="When you leave",
                low=det.best.value - exp,
                high=det.worst.value - exp,
                note="best to worst exit point among those with odds > 0",
            ),
        )
    return ScenarioResult(
        ranking_measure=ranking_measure,
        exit_odds=odds,
        seed=sc.seed,
        draws=sc.draws,
        options=results,
        ruled_out=ruled,
        sensitivity=sensitivity,
        sensitivity_option_id=top_id,
    )


def expected_of(values: list[int], sc: Scenario) -> int:
    return expected(values, sc.user.exit_odds.as_dict())


__all__ = [
    "ScenarioResult",
    "RuledOut",
    "SensitivityRow",
    "run_scenario",
    "apply_limits",
    "date",
    "Decimal",
]
