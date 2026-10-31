"""Apply user overrides to a Scenario without mutating it (spec 022 R10, R11).

Two kinds:
- what-if knobs (return on cash, km per year, pay mode, used-price drift,
  loan rate on every loan) from the Curves view sliders;
- input overrides by input id from the Detail screen's Override button,
  which replace one `In` wherever it occurs and mark it Live with the
  user's own source.

The engine has no clock, so the caller passes `as_of`.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from pydantic import BaseModel

from .models import In, Scenario


class WhatIf(BaseModel):
    return_on_cash_pct: Decimal | None = None
    loan_rate_pct: Decimal | None = None
    km_per_year: int | None = None
    used_price_drift_pct: Decimal | None = None
    pay_mode: str | None = None


def _coerce(old: Any, new: Any) -> Any:
    if isinstance(old, bool):
        return bool(new)
    if isinstance(old, int):
        return int(round(float(new)))
    if isinstance(old, Decimal):
        try:
            return Decimal(str(new))
        except InvalidOperation as exc:
            raise ValueError(f"not a number: {new!r}") from exc
    if isinstance(old, str):
        return str(new)
    return new


def _replace_inputs(obj: Any, overrides: dict[str, Any], as_of: date) -> Any:
    """Recursively rebuild pydantic models/tuples, swapping matching `In`s."""
    if isinstance(obj, In):
        if obj.id in overrides:
            return obj.model_copy(
                update={
                    "value": _coerce(obj.value, overrides[obj.id]),
                    "source": "Your override",
                    "as_of": as_of,
                    "status": "live",
                    "basis": None,
                }
            )
        return obj
    if isinstance(obj, BaseModel):
        changes = {}
        for name in type(obj).model_fields:
            cur = getattr(obj, name)
            new = _replace_inputs(cur, overrides, as_of)
            if new is not cur:
                changes[name] = new
        return obj.model_copy(update=changes) if changes else obj
    if isinstance(obj, tuple):
        new_items = tuple(_replace_inputs(x, overrides, as_of) for x in obj)
        return new_items if any(a is not b for a, b in zip(new_items, obj, strict=True)) else obj
    if isinstance(obj, list):
        return [_replace_inputs(x, overrides, as_of) for x in obj]
    return obj


def apply_input_overrides(sc: Scenario, overrides: dict[str, Any], as_of: date) -> Scenario:
    if not overrides:
        return sc
    out = _replace_inputs(sc, overrides, as_of)
    return Scenario.model_validate(out.model_dump())


def apply_what_if(sc: Scenario, w: WhatIf, as_of: date) -> Scenario:
    user_changes: dict[str, Any] = {}
    if w.return_on_cash_pct is not None:
        user_changes["return_on_cash_pct"] = w.return_on_cash_pct
    if w.km_per_year is not None:
        user_changes["km_per_year"] = w.km_per_year
    if w.pay_mode in ("cash", "loan"):
        user_changes["pay_mode"] = w.pay_mode
    market = sc.market
    if w.used_price_drift_pct is not None:
        market = market.model_copy(
            update={
                "used_price_drift": market.used_price_drift.model_copy(
                    update={
                        "value": w.used_price_drift_pct,
                        "source": "What-if slider",
                        "as_of": as_of,
                    }
                )
            }
        )
    options = sc.options
    if w.loan_rate_pct is not None:
        ids = {
            o.deal.loan.annual_rate_pct.id
            for o in sc.options
            if getattr(o.deal, "loan", None) is not None
        }
        if ids:
            sc2 = apply_input_overrides(sc, {i: w.loan_rate_pct for i in ids}, as_of)
            options = sc2.options
    return sc.model_copy(
        update={
            "user": sc.user.model_copy(update=user_changes) if user_changes else sc.user,
            "market": market,
            "options": options,
        }
    )
