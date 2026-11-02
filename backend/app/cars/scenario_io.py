"""Scenario YAML -> engine `Scenario` (spec 022 R3, R12).

The YAML is written for humans: money in NOK (`value_nok`, `range_nok`),
provenance fields spelled out once per input, and a resale `retention`
shorthand that the loader expands into a 61-month path (flagged Estimate)
until the market model supplies a fitted path. This module does I/O; the
engine package does not.

Input block shape (every outside value):

    efficiency_wh_per_km:
      value: 160                # or value_nok: 12000 for money
      source: "NAF El Prix 2025"
      as_of: 2025-03-01
      status: live              # or estimate (then `basis` is required)
      basis: "..."
      range: [140, 190]         # optional P10–P90 (range_nok for money)
"""

from __future__ import annotations

import math
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

import yaml

from .engine.defaults import default_insurance
from .engine.models import (
    MONTHS,
    BuyNew,
    ChargingMix,
    ChargingPrices,
    DefaultEarlyExit,
    ExitOdds,
    FixedTable,
    In,
    InsuranceDefault,
    InsuranceProfile,
    Lease,
    Limits,
    Loan,
    MarketPolicyInputs,
    Option,
    PercentOfRemaining,
    Range,
    RepairAllowance,
    ResalePath,
    Scenario,
    TollRing,
    Used,
    UserInputs,
    VehicleInputs,
)
from .engine.money import nok
from .rules import load_tax_rules


def _d(x: Any) -> Decimal:
    return Decimal(str(x))


def _date(x: Any) -> date:
    return x if isinstance(x, date) else date.fromisoformat(str(x))


def load_in(block: dict[str, Any], id: str, money: bool = False, kind: type = int) -> In:
    if "value_nok" in block:
        value: Any = nok(_d(block["value_nok"]))
        rng = block.get("range_nok")
        rng = Range(low=Decimal(nok(_d(rng[0]))), high=Decimal(nok(_d(rng[1])))) if rng else None
    else:
        raw = block["value"]
        value = _d(raw) if kind is Decimal else (kind(raw) if kind is not str else str(raw))
        rng = block.get("range")
        rng = Range(low=_d(rng[0]), high=_d(rng[1])) if rng else None
    return In(
        id=block.get("id", id),
        value=value,
        source=str(block["source"]),
        as_of=_date(block["as_of"]),
        status=block.get("status", "live"),
        basis=block.get("basis"),
        range=rng,
    )


def _loan(block: dict[str, Any] | None, prefix: str) -> Loan | None:
    if not block:
        return None
    return Loan(
        annual_rate_pct=load_in(block["annual_rate_pct"], f"{prefix}.loan_rate", kind=Decimal),
        term_months=int(block["term_months"]),
        establishment_fee_ore=load_in(
            block["establishment_fee"], f"{prefix}.loan_establishment_fee"
        ),
        monthly_fee_ore=load_in(block["monthly_fee"], f"{prefix}.loan_monthly_fee"),
    )


def _early_exit(block: dict[str, Any], prefix: str):
    kind = block.get("kind", "default_estimate")
    if kind == "percent_of_remaining":
        return PercentOfRemaining(
            percent=load_in(block["percent"], f"{prefix}.early_exit_pct", kind=Decimal)
        )
    if kind == "fixed_table":
        return FixedTable(
            by_month={int(k): nok(_d(v)) for k, v in block["by_month_nok"].items()},
            source=load_in(block["source"], f"{prefix}.early_exit_table", kind=str),
        )
    return DefaultEarlyExit(
        recovery_pct=load_in(block["recovery_pct"], f"{prefix}.early_exit_recovery", kind=Decimal)
    )


def _vehicle(v: dict[str, Any], prefix: str) -> VehicleInputs:
    return VehicleInputs(
        variant_id=v["variant_id"],
        make=v["make"],
        model=v["model"],
        trim_group=v["trim_group"],
        model_year=int(v["model_year"]),
        energy_type=v.get("energy_type", "ev"),
        drive=v.get("drive", "rwd"),
        body=v.get("body", ""),
        battery_kwh=_d(v["battery_kwh"]) if v.get("battery_kwh") is not None else None,
        power_kw=v.get("power_kw"),
        heat_pump=bool(v.get("heat_pump", True)),
        auto_precondition=bool(v.get("auto_precondition", True)),
        tyre_size=v.get("tyre_size", ""),
        weight_kg=v.get("weight_kg"),
        efficiency_wh_per_km=load_in(v["efficiency_wh_per_km"], f"{prefix}.efficiency"),
        winter_factor=load_in(v["winter_factor"], f"{prefix}.winter_factor", kind=Decimal),
        tyre_set_ore=load_in(v["tyre_set"], f"{prefix}.tyre_set"),
        tyre_life_km=load_in(v["tyre_life_km"], f"{prefix}.tyre_life_km"),
        service_interval_months=int(v.get("service_interval_months", 0)),
        service_interval_km=int(v.get("service_interval_km", 0)),
        service_first_months=int(v.get("service_first_months", 0)),
        service_price_ore=load_in(v["service_price"], f"{prefix}.service_price"),
        service_first_price_ore=load_in(v["service_first_price"], f"{prefix}.service_first_price")
        if v.get("service_first_price")
        else None,
        service_price_after_7y_ore=load_in(
            v["service_price_after_7y"], f"{prefix}.service_price_after_7y"
        )
        if v.get("service_price_after_7y")
        else None,
        wear_per_year_ore=load_in(v["wear_per_year"], f"{prefix}.wear_per_year"),
        warranty_years=int(v.get("warranty_years", 5)),
        warranty_km=int(v.get("warranty_km", 100_000)),
        fun_score=load_in(v["fun_score"], f"{prefix}.fun_score", kind=Decimal),
        new_price_ore=load_in(v["new_price"], f"{prefix}.new_price")
        if v.get("new_price")
        else None,
    )


def _deal(dd: dict[str, Any], prefix: str):
    mode = dd["mode"]
    if mode == "new":
        return BuyNew(
            price_ore=load_in(dd["price"], f"{prefix}.price"),
            fees_ore=load_in(dd["fees"], f"{prefix}.fees"),
            delivery_months=load_in(dd["delivery_months"], f"{prefix}.delivery_months"),
            registered_on=_date(dd["registered_on"]),
            loan=_loan(dd.get("loan"), prefix),
            exit_friction_pct=load_in(
                dd["exit_friction_pct"], f"{prefix}.exit_friction_pct", kind=Decimal
            ),
        )
    if mode == "lease":
        return Lease(
            term_months=int(dd["term_months"]),
            monthly_ore=load_in(dd["monthly"], f"{prefix}.lease_monthly"),
            upfront_ore=load_in(dd["upfront"], f"{prefix}.lease_upfront"),
            fees_ore=load_in(dd["fees"], f"{prefix}.lease_fees"),
            km_cap_per_year=load_in(dd["km_cap_per_year"], f"{prefix}.lease_km_cap"),
            excess_km_fee_ore=load_in(dd["excess_km_fee"], f"{prefix}.lease_excess_km_fee"),
            includes=tuple(dd.get("includes", ())),
            early_exit=_early_exit(dd.get("early_exit", {}), prefix),
            end_of_lease_fee_ore=load_in(dd["end_of_lease_fee"], f"{prefix}.lease_end_fee"),
            delivery_months=load_in(dd["delivery_months"], f"{prefix}.delivery_months"),
            pay_in_advance=bool(dd.get("pay_in_advance", True)),
            age_months_at_start=int(dd.get("age_months_at_start", 0)),
        )
    return Used(
        mode=mode,
        price_ore=load_in(dd["price"], f"{prefix}.price"),
        age_months_at_purchase=int(dd["age_months_at_purchase"]),
        km_at_purchase=int(dd["km_at_purchase"]),
        seller_type=dd["seller_type"],
        purchase_date=_date(dd["purchase_date"]),
        delivery_months=load_in(dd["delivery_months"], f"{prefix}.delivery_months"),
        loan=_loan(dd.get("loan"), prefix),
        exit_friction_pct=load_in(
            dd["exit_friction_pct"], f"{prefix}.exit_friction_pct", kind=Decimal
        ),
        remaining_warranty_months=int(dd.get("remaining_warranty_months", 0)),
    )


def retention_path(
    price_ore: int,
    annual_retention: Decimal,
    floor_ore: int,
    base_log_sigma: float,
    log_sigma_per_year: float,
    source: In[str],
) -> ResalePath:
    """Shorthand resale path: value falls geometrically from the purchase
    price toward a floor; sigma grows with the horizon (Estimate until the
    market model supplies a fitted path)."""
    r = float(annual_retention)
    p50 = []
    sig = []
    for t in range(MONTHS):
        v = int(round(price_ore * (r ** (t / 12.0))))
        p50.append(max(v, floor_ore))
        sig.append(math.sqrt(base_log_sigma**2 + (log_sigma_per_year * t / 12.0) ** 2))
    return ResalePath(p50_ore=tuple(p50), log_sigma=tuple(sig), source=source)


def _resale(block: dict[str, Any] | None, price_ore: int, prefix: str) -> ResalePath | None:
    if block is None:
        return None
    if "p50_nok" in block:
        src = load_in(block["source"], f"{prefix}.resale_path", kind=str)
        return ResalePath(
            p50_ore=tuple(nok(_d(v)) for v in block["p50_nok"]),
            log_sigma=tuple(float(v) for v in block["log_sigma"]),
            source=src,
        )
    ret = block["retention"]
    src = (
        load_in(ret, f"{prefix}.resale_retention", kind=str)
        if "value" in ret
        else In[str](
            id=f"{prefix}.resale_retention",
            value=f"annual retention {ret['annual']}",
            source=str(ret["source"]),
            as_of=_date(ret["as_of"]),
            status=ret.get("status", "estimate"),
            basis=ret.get(
                "basis", "geometric retention shorthand until a fitted cohort path exists"
            ),
        )
    )
    return retention_path(
        price_ore,
        _d(ret["annual"]),
        nok(_d(ret.get("floor_nok", 0))),
        float(ret.get("base_log_sigma", 0.06)),
        float(ret.get("log_sigma_per_year", 0.08)),
        src,
    )


def _repair(block: dict[str, Any]) -> RepairAllowance:
    return RepairAllowance(
        bands=tuple((int(km), int(ore)) for km, ore in block["bands_ore_per_km"]),
        source=load_in(block["source"], "market.repair_allowance", kind=str),
        ev_factor=load_in(block["ev_factor"], "market.repair_ev_factor", kind=Decimal),
        in_warranty_factor=load_in(
            block["in_warranty_factor"], "market.repair_in_warranty_factor", kind=Decimal
        ),
    )


def _toll_ring(block: dict[str, Any] | None) -> TollRing | None:
    if not block:
        return None
    return TollRing(
        name=str(block["name"]),
        offpeak_ore=load_in(block["offpeak"], "market.toll_offpeak"),
        rush_ore=load_in(block["rush"], "market.toll_rush"),
        monthly_cap_passages=int(block.get("monthly_cap", 0)),
        source=load_in(block["source"], "market.toll_ring", kind=str),
    )


def scenario_from_dict(data: dict[str, Any], base_dir: Path | None = None) -> Scenario:
    u = data["user"]
    user = UserInputs(
        exit_odds=ExitOdds(**u["exit_odds"]),
        km_per_year=int(u["km_per_year"]),
        charging_mix=ChargingMix(**u["charging_mix"]),
        municipality=u.get("municipality", ""),
        toll_passages_per_week=int(u.get("toll_passages_per_week", 0)),
        pay_mode=u.get("pay_mode", "loan"),
        return_on_cash_pct=_d(u.get("return_on_cash_pct", 4)),
        down_payment_ore=nok(_d(u.get("down_payment_nok", 0))),
        insurance=InsuranceProfile(**u["insurance"]),
        limits=Limits(
            max_price_ore=nok(_d(u["limits"]["max_price_nok"]))
            if u.get("limits", {}).get("max_price_nok")
            else None,
            need_by=_date(u["limits"]["need_by"]) if u.get("limits", {}).get("need_by") else None,
            must_haves=tuple(u.get("limits", {}).get("must_haves", ())),
            modes=tuple(
                u.get("limits", {}).get("modes", ("new", "lease", "used_1_3", "used_5_plus"))
            ),
        ),
        fun_weight=int(u.get("fun_weight", 50)),
        start_date=_date(u["start_date"]),
    )
    m = data["market"]
    rules_ref = m.get("tax_rules")
    if isinstance(rules_ref, str):
        rules = load_tax_rules((base_dir or Path(".")) / rules_ref)
    else:
        rules = load_tax_rules()
    market = MarketPolicyInputs(
        tax_rules=rules,
        charging=ChargingPrices(
            home_ore_per_kwh=load_in(m["charging"]["home"], "market.charging_home"),
            public_ore_per_kwh=load_in(m["charging"]["public"], "market.charging_public"),
        ),
        used_price_drift=load_in(m["used_price_drift"], "market.used_price_drift", kind=Decimal),
        rental_per_month_ore=load_in(m["rental_per_month"], "market.rental_per_month"),
        materiality_threshold=load_in(
            m["materiality_threshold"], "market.materiality_threshold", kind=Decimal
        ),
        repair=_repair(m["repair"]),
        inspection_fee_ore=load_in(m["inspection_fee"], "market.inspection_fee"),
        wheel_change_ore=load_in(m["wheel_change"], "market.wheel_change"),
        toll_ring=_toll_ring(m.get("toll_ring")),
    )
    options = []
    for o in data["options"]:
        prefix = o["id"]
        vehicle = _vehicle(o["vehicle"], prefix)
        deal = _deal(o["deal"], prefix)
        price = (
            deal.price_ore.value
            if deal.mode != "lease"
            else nok(_d(o["vehicle"].get("new_price", {}).get("value_nok", 400000)))
        )
        ins_block = o.get("insurance")
        insurance = InsuranceDefault(
            annual_ore=load_in(ins_block["annual"], f"{prefix}.insurance_annual")
            if ins_block
            else default_insurance(user.insurance, price, prefix)
        )
        resale = (
            None if deal.mode == "lease" else _resale(o.get("resale"), deal.price_ore.value, prefix)
        )
        options.append(
            Option(
                id=o["id"],
                label=o["label"],
                vehicle=vehicle,
                deal=deal,
                insurance=insurance,
                resale=resale,
            )
        )
    return Scenario(
        user=user,
        market=market,
        options=tuple(options),
        seed=int(data.get("seed", 0)),
        draws=int(data.get("draws", 2000)),
    )


def load_scenario(path: Path) -> Scenario:
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return scenario_from_dict(data, base_dir=path.parent)
