"""Scenario-dict builders shared by golden cases and property tests.

Round numbers by design so the golden cases can be worked by hand:
12 000 km/yr (1 000 km/month), 200 Wh/km at 100 øre/kWh charged at home
(200 kr/month energy), 12 000 kr/yr insurance, a 1 200 kr service every
12 months, no wear/repair/inspection/wheel-change/toll amounts (zero
fixtures), a 10 000 kr tyre set that never wears out, fixture tax rules
(10 kr/day, 5 000 kr re-registration, inspection at 48 then every 24 months).
"""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

FIXTURES = Path(__file__).parent / "fixtures"
AS_OF = "2026-10-31"


def inp(value: Any, **kw: Any) -> dict[str, Any]:
    d = {"value": value, "source": "golden fixture", "as_of": AS_OF, "status": "live"}
    d.update(kw)
    return d


def nok(value: Any, **kw: Any) -> dict[str, Any]:
    d = {"value_nok": value, "source": "golden fixture", "as_of": AS_OF, "status": "live"}
    d.update(kw)
    return d


def vehicle(**over: Any) -> dict[str, Any]:
    v = {
        "variant_id": "fx-ev",
        "make": "Fixture",
        "model": "EV",
        "trim_group": "Base",
        "model_year": 2023,
        "energy_type": "ev",
        "drive": "rwd",
        "battery_kwh": 60,
        "heat_pump": True,
        "auto_precondition": True,
        "efficiency_wh_per_km": inp(200),
        "winter_factor": inp(1.0),
        "tyre_set": nok(10000),
        "tyre_life_km": inp(1_000_000),
        "service_interval_months": 12,
        "service_interval_km": 0,
        "service_price": nok(1200),
        "wear_per_year": nok(0),
        "fun_score": inp(5),
        "new_price": nok(400000),
    }
    v.update(over)
    return v


def user(**over: Any) -> dict[str, Any]:
    u = {
        "start_date": "2027-01-01",
        "exit_odds": {"p12": 50, "p24": 0, "p36": 50, "p48": 0},
        "km_per_year": 12000,
        "charging_mix": {"home_pct": 100, "work_free_pct": 0, "public_pct": 0},
        "pay_mode": "loan",
        "return_on_cash_pct": 0,
        "down_payment_nok": 0,
        "insurance": {"age_band": "30-39", "claims_free_years": 5, "has_claims_free_letter": False},
        "limits": {"modes": ["new", "lease", "used_1_3", "used_5_plus"]},
    }
    u.update(over)
    return u


def market(rules: str = "tax_rules_fixture.yaml", **over: Any) -> dict[str, Any]:
    m = {
        "tax_rules": str(FIXTURES / rules),
        "charging": {"home": inp(100), "public": inp(500)},
        "used_price_drift": inp(0),
        "rental_per_month": nok(0),
        "materiality_threshold": inp(0.05),
        "inspection_fee": nok(0),
        "wheel_change": nok(0),
        "repair": repair(),
    }
    m.update(over)
    return m


def repair(
    bands: list[list[int]] | None = None, ev_factor: Any = 1, in_warranty_factor: Any = 1
) -> dict[str, Any]:
    """Repair allowance block; the default has a zero rate everywhere."""
    return {
        "bands_ore_per_km": bands or [[999999999, 0]],
        "source": inp("fixture repair table", kind="str"),
        "ev_factor": inp(ev_factor),
        "in_warranty_factor": inp(in_warranty_factor),
    }


def insurance(annual_nok: int = 12000, **kw: Any) -> dict[str, Any]:
    return {"annual": nok(annual_nok, **kw)}


def resale_points(price_nok: int, by_year: dict[int, int]) -> dict[str, Any]:
    """Explicit 61-point P50 path (NOK) from values at 0/12/24/36/48/60,
    linearly interpolated between them; sigma 0 everywhere (deterministic)."""
    pts = {0: price_nok, **by_year}
    if 60 not in pts:
        pts[60] = pts[max(pts)]
    keys = sorted(pts)
    out = []
    for t in range(61):
        hi = next(k for k in keys if k >= t)
        lo = max(k for k in keys if k <= t)
        if hi == lo:
            out.append(pts[lo])
        else:
            frac = (t - lo) / (hi - lo)
            out.append(round(pts[lo] + (pts[hi] - pts[lo]) * frac, 2))
    return {
        "p50_nok": out,
        "log_sigma": [0.0] * 61,
        "source": inp("explicit fixture path", kind="str"),
    }


def used_cash(
    id: str = "used-cash",
    price_nok: int = 200000,
    resale: dict[str, Any] | None = None,
    mode: str = "used_1_3",
    age_months: int = 36,
    **deal_over: Any,
) -> dict[str, Any]:
    deal = {
        "mode": mode,
        "price": nok(price_nok),
        "age_months_at_purchase": age_months,
        "km_at_purchase": 40000,
        "seller_type": "dealer",
        "purchase_date": "2027-01-01",
        "delivery_months": inp(0),
        "exit_friction_pct": inp(5),
    }
    deal.update(deal_over)
    return {
        "id": id,
        "label": id,
        "vehicle": vehicle(),
        "deal": deal,
        "insurance": insurance(),
        "resale": resale
        or resale_points(price_nok, {12: 180000, 24: 162000, 36: 145800, 48: 131220}),
    }


def lease(id: str = "lease-36", **deal_over: Any) -> dict[str, Any]:
    deal = {
        "mode": "lease",
        "term_months": 36,
        "monthly": nok(5000),
        "upfront": nok(30000),
        "fees": nok(2000),
        "km_cap_per_year": inp(10000),
        "excess_km_fee": nok(2),
        "includes": [],
        "early_exit": {"kind": "percent_of_remaining", "percent": inp(50)},
        "end_of_lease_fee": nok(3000),
        "delivery_months": inp(0),
    }
    deal.update(deal_over)
    return {"id": id, "label": id, "vehicle": vehicle(), "deal": deal, "insurance": insurance()}


def scenario(options: list[dict[str, Any]], **over: Any) -> dict[str, Any]:
    d = {"seed": 1, "draws": 200, "user": user(), "market": market(), "options": options}
    d.update(over)
    return copy.deepcopy(d)
