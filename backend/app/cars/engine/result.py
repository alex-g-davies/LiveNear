"""Result shapes and the per-option assembly (spec 022 R3–R5, R10).

These Pydantic models are what the API returns, so field names are stable.
All amounts are integer øre.
"""

from __future__ import annotations

import math
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
    "service": "Service and repairs",
    "tolls": "Tolls",
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
    label: str
    value: str  # raw engine value (øre for money); overrides are sent in these units
    unit: str | None  # "kr", "kr/year", "%", "km" … or None when the value is text
    display_value: str  # value in display units, e.g. "131 308 kr"
    display_range: tuple[str, str] | None
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
    material_estimate_labels: list[str]
    cash_up_front: int
    km_at: list[int]
    measures: dict[str, MeasureResult]
    line_items: list[LineItemView]
    display: dict[int, list[DisplayItem]]
    display_series: dict[str, list[int]]  # display row key -> value at month 0..60
    inputs: list[InputView]
    purchase_price: int | None  # None for leases
    resale_p50: list[int] | None
    resale_band: Band | None  # single-car P10/P50/P90 of the resale value by month


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
    rows.append(("service", cum("service") + cum("wear_and_repairs") + cum("inspection")))
    rows.append(("tolls", cum("tolls")))
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
        unit = input_unit(rec.id, rec.value)
        inputs.append(
            InputView(
                id=rec.id,
                label=input_label(rec.id),
                value=_fmt(rec.value),
                unit=unit,
                display_value=display_value(rec.value, unit),
                display_range=(
                    (display_value(rec.range.low, unit), display_value(rec.range.high, unit))
                    if rec.range
                    else None
                ),
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
    by_month = [_display_at(s, det, t) for t in range(MONTHS)]
    display_series = {
        row.key: [by_month[t][i].ore for t in range(MONTHS)] for i, row in enumerate(by_month[0])
    }
    resale_band = None
    if option.resale is not None:
        p50 = option.resale.p50_ore
        sig = option.resale.log_sigma
        resale_band = Band(
            p10=[int(round(v * math.exp(-Z10 * sg))) for v, sg in zip(p50, sig, strict=True)],
            p50=list(p50),
            p90=[int(round(v * math.exp(Z10 * sg))) for v, sg in zip(p50, sig, strict=True)],
        )
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
        material_estimate_labels=[material_label(m) for m in material_estimates],
        material_estimates=sorted(set(material_estimates)),
        cash_up_front=det.cash_up_front,
        km_at=s.km_at,
        measures=measures,
        line_items=line_items,
        display={t: by_month[t] for t in EXIT_POINTS},
        display_series=display_series,
        inputs=inputs,
        purchase_price=purchase_price_of(option),
        resale_p50=list(option.resale.p50_ore) if option.resale else None,
        resale_band=resale_band,
    )
    return result, s, det, sim


INPUT_LABELS = {
    "price": "Purchase price",
    "fees": "Fees",
    "delivery_months": "Months until delivery",
    "loan_rate": "Loan rate",
    "loan_establishment_fee": "Loan establishment fee",
    "loan_monthly_fee": "Loan monthly fee",
    "exit_friction_pct": "Cost to exit (% of value)",
    "insurance_annual": "Insurance (per year)",
    "efficiency": "Energy use (Wh/km)",
    "winter_factor": "Winter factor",
    "tyre_set": "Winter tyres",
    "tyre_life_km": "Tyre life (km)",
    "service_price": "Service (per visit)",
    "service_first_price": "First service",
    "service_price_after_7y": "Service (car 7+ years)",
    "wear_per_year": "Wear items (per year)",
    "repair_allowance": "Repair allowance table (per km)",
    "repair_ev_factor": "EV repair factor",
    "repair_in_warranty_factor": "In-warranty repair factor",
    "inspection_fee": "Inspection fee (EU-kontroll)",
    "wheel_change": "Wheel change (per change)",
    "toll_offpeak": "Toll per passage (off-peak)",
    "toll_rush": "Toll per passage (rush)",
    "toll_ring": "Toll ring",
    "fun_score": "Fun score",
    "new_price": "New price",
    "resale_path": "Resale value path",
    "resale_retention": "Resale value path",
    "lease_monthly": "Lease monthly payment",
    "lease_upfront": "Lease upfront rent",
    "lease_fees": "Lease fees",
    "lease_km_cap": "Lease km cap",
    "lease_excess_km_fee": "Excess km fee",
    "lease_end_fee": "End-of-lease fee",
    "early_exit_pct": "Early-exit charge (%)",
    "early_exit_recovery": "Early-exit recovery (%)",
    "early_exit_table": "Early-exit table",
    "charging_home": "Home charging price",
    "charging_public": "Public charging price",
    "home_ore_per_kwh": "Home charging price (øre/kWh)",
    "public_ore_per_kwh": "Public charging price (øre/kWh)",
    "monthly": "Lease monthly payment",
    "upfront": "Lease upfront rent",
    "km_cap": "Lease km cap (per year)",
    "excess_km_fee": "Excess km fee (per km)",
    "end_fee": "End-of-lease fee",
    "dealer_premium": "Dealer asking premium",
    "ask_to_sale_discount": "Ask-to-sale discount",
    "used_price_drift": "Used-car price drift",
    "rental_per_month": "Rental while waiting",
    "materiality_threshold": "Materiality threshold",
}


Z10 = 1.2815515655446004  # standard-normal 90th percentile: P10/P90 of a lognormal path

# Units by input id tail. Money inputs are integer øre in the engine; the
# display value converts to kroner. Anything not listed is shown as is.
INPUT_UNITS = {
    "price": "kr",
    "new_price": "kr",
    "fees": "kr",
    "loan_establishment_fee": "kr",
    "loan_monthly_fee": "kr/month",
    "tyre_set": "kr",
    "service_price": "kr",
    "service_first_price": "kr",
    "service_price_after_7y": "kr",
    "inspection_fee": "kr",
    "wheel_change": "kr",
    "insurance_annual": "kr/year",
    "wear_per_year": "kr/year",
    "lease_monthly": "kr/month",
    "monthly": "kr/month",
    "rental_per_month": "kr/month",
    "lease_upfront": "kr",
    "upfront": "kr",
    "lease_fees": "kr",
    "lease_end_fee": "kr",
    "end_fee": "kr",
    "lease_excess_km_fee": "kr/km",
    "excess_km_fee": "kr/km",
    "toll_offpeak": "kr/passage",
    "toll_rush": "kr/passage",
    "home_ore_per_kwh": "øre/kWh",
    "public_ore_per_kwh": "øre/kWh",
    "charging_home": "øre/kWh",
    "charging_public": "øre/kWh",
    "loan_rate": "%",
    "exit_friction_pct": "%",
    "early_exit_pct": "%",
    "early_exit_recovery": "%",
    "used_price_drift": "%",
    "dealer_premium": "%",
    "ask_to_sale_discount": "%",
    "delivery_months": "months",
    "tyre_life_km": "km",
    "lease_km_cap": "km/year",
    "km_cap": "km/year",
    "efficiency": "Wh/km",
    "winter_factor": "×",
    "repair_ev_factor": "×",
    "repair_in_warranty_factor": "×",
}
MONEY_UNITS = ("kr", "kr/year", "kr/month", "kr/km", "kr/passage", "kr/day")


def input_unit(input_id: str, value: object) -> str | None:
    """Unit of an input by id tail; tax rules by kind; text and tables have none."""
    if isinstance(value, str):
        return None
    tail = input_id.rsplit(".", 1)[-1]
    if tail in INPUT_UNITS:
        return INPUT_UNITS[tail]
    for key, unit in INPUT_UNITS.items():
        if tail.endswith(key):
            return unit
    if tail.startswith("traffic_tax"):
        return "kr/day"
    if tail.startswith("re_registration"):
        return "kr"
    if "periodic_inspection" in tail:
        return "months"
    return None


def _group(n: int) -> str:
    return f"{n:,}".replace(",", "\u00a0")


def fmt_kr(ore: int) -> str:
    """Integer øre -> "131 308" or "9,16": nb-NO grouping, whole kroner from
    100 kr upwards, two decimals below that (per-day and per-km rates)."""
    sign = "-" if ore < 0 else ""
    if abs(ore) >= 10_000:
        return f"{sign}{_group((abs(int(ore)) + 50) // 100)}"
    kr, rest = divmod(abs(int(ore)), 100)
    return f"{sign}{_group(kr)}" if rest == 0 else f"{sign}{_group(kr)},{rest:02d}"


def _fmt_number(v: object) -> str:
    if isinstance(v, Decimal):
        return format(v.normalize(), "f").replace(".", ",")
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, int):
        return _group(v)
    if isinstance(v, float):
        return f"{v:g}".replace(".", ",")
    return str(v)


# Words for the keys of dict-valued rules, so no config key reaches the screen
# (spec 027 R5). Unknown keys fall back to their humanised form.
DICT_KEY_LABELS: dict[str, str] = {
    "ev": "electric",
    "phev": "plug-in hybrid",
    "hybrid": "hybrid",
    "ice": "petrol or diesel",
    "first_after_months": "first at",
    "every_months": "then every",
}


def _key_label(key: object) -> str:
    k = str(key)
    return DICT_KEY_LABELS.get(k, k.replace("_", " "))


def display_value(v: object, unit: str | None) -> str:
    """Value in display units: money converted from øre, unit appended,
    dict values (tax rules per energy type, inspection cycle) listed in words."""
    if isinstance(v, dict):
        text = ", ".join(f"{_key_label(k)} {display_value(x, unit)}" for k, x in v.items())
        return text[:1].upper() + text[1:]
    if unit is None:
        return _fmt(v)
    if unit in MONEY_UNITS and isinstance(v, int | Decimal | float) and not isinstance(v, bool):
        return f"{fmt_kr(int(round(v)))}\u00a0{unit}"
    if unit == "%":
        return f"{_fmt_number(v)}\u00a0%"
    if unit == "×":
        return f"×\u00a0{_fmt_number(v)}"
    return f"{_fmt_number(v)}\u00a0{unit}"


def material_label(material_id: str) -> str:
    """Label for a material-estimate entry: an input id or `item:<key>`."""
    if material_id.startswith("item:"):
        return ITEM_LABELS.get(material_id[5:], material_id[5:].replace("_", " ").capitalize())
    return input_label(material_id)


def input_label(input_id: str) -> str:
    """Human label for an input id: the last dotted segment, mapped or humanised."""
    tail = input_id.rsplit(".", 1)[-1]
    if tail in INPUT_LABELS:
        return INPUT_LABELS[tail]
    for key, label in INPUT_LABELS.items():
        if tail.endswith(key):
            return label
    if tail.startswith("traffic_tax"):
        return "Traffic insurance tax rule"
    if tail.startswith("re_registration"):
        return "Re-registration fee rule"
    if "periodic_inspection" in tail:
        return "Inspection cycle rule"
    return tail.replace("_", " ").capitalize()


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
