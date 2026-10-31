"""Row validation (spec 022 R8): small named rules returning failures.

Pipeline per row: `normalise_listing(row)` converts units in place
(NOK incl. VAT -> øre, kW/hp -> kW, km text -> int) and adds the normalised
fields next to the originals; then each rule in `LISTING_RULES` returns a
list of failure strings. Rows with any failure go to
`quarantine/<source>-<date>.csv` with `failed_checks` and `raw_excerpt`,
never to the store. LLM-extracted rows: not in this run (no such source).
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from ..engine.money import nok
from ..market.schema import age_years

HP_TO_KW = 0.7355
PRICE_BAND = (0.25, 4.0)  # x cohort prior value
KM_PER_YEAR_MAX = 60_000
KM_SLACK = 15_000
RANGE_PER_KWH = (3.0, 9.0)  # km of WLTP range per kWh: EV sanity band

PriorValue = Callable[[str, int, int], int | None]  # (variant_id, model_year, km) -> øre


@dataclass
class ValidationContext:
    as_of: date
    prior_value: PriorValue | None = None


@dataclass
class QuarantinedRow:
    row: dict[str, Any]
    failed_checks: list[str] = field(default_factory=list)

    @property
    def raw_excerpt(self) -> str:
        safe = {k: v for k, v in self.row.items() if k not in {"reg_number", "vin"}}
        return json.dumps(safe, ensure_ascii=False, default=str)[:300]


Rule = Callable[[dict[str, Any], ValidationContext], list[str]]


# ------------------------------------------------------------------ unit parsers


def parse_decimal(text: Any) -> Decimal | None:
    if text is None:
        return None
    s = str(text).strip().replace(" ", "").replace(" ", "").replace(",", ".")
    s = re.sub(r"(?i)(kr|nok)$", "", s).strip()
    if not s:
        return None
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


def parse_nok_to_ore(text: Any) -> int | None:
    d = parse_decimal(text)
    return nok(d) if d is not None else None


def parse_km(text: Any) -> int | None:
    if text is None:
        return None
    s = re.sub(r"(?i)km$", "", str(text).strip()).strip()
    d = parse_decimal(s)
    return int(d) if d is not None else None


def parse_power_kw(text: Any) -> int | None:
    """'150', '150 kW', '204 hp', '204 hk' -> kW."""
    if text is None:
        return None
    s = str(text).strip().lower()
    m = re.match(r"^\s*([\d.,]+)\s*(kw|hp|hk|bhp|ps)?\s*$", s)
    if not m:
        return None
    d = parse_decimal(m.group(1))
    if d is None:
        return None
    unit = m.group(2) or "kw"
    value = float(d) * (HP_TO_KW if unit in {"hp", "hk", "bhp", "ps"} else 1.0)
    return int(round(value))


def normalise_listing(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    out["ask_ore"] = parse_nok_to_ore(row.get("asking_price_nok"))
    out["km"] = parse_km(row.get("km"))
    out["power_kw"] = parse_power_kw(row.get("power_kw_or_hp"))
    bat = parse_decimal(row.get("battery_kwh"))
    out["battery_kwh"] = str(bat) if bat is not None else ""
    out["seller_type"] = str(row.get("seller_type") or "").strip().lower()
    out["status"] = str(row.get("status") or "listed").strip().lower()
    out["drive"] = str(row.get("drive") or "").strip().upper()
    return out


# ------------------------------------------------------------------ rules

LISTING_REQUIRED = (
    "snapshot_date",
    "ad_id_or_url",
    "make",
    "model",
    "model_year",
    "km",
    "asking_price_nok",
)


def required_fields(row: dict[str, Any], ctx: ValidationContext) -> list[str]:
    return [f"missing:{k}" for k in LISTING_REQUIRED if str(row.get(k) or "").strip() == ""]


def field_types(row: dict[str, Any], ctx: ValidationContext) -> list[str]:
    out: list[str] = []
    try:
        date.fromisoformat(str(row.get("snapshot_date", "")))
    except ValueError:
        out.append("type:snapshot_date")
    try:
        year = int(str(row.get("model_year", "")))
        if not 2010 <= year <= ctx.as_of.year + 1:
            out.append("range:model_year")
    except ValueError:
        out.append("type:model_year")
    if row.get("ask_ore") is None or row["ask_ore"] <= 0:
        out.append("type:asking_price_nok")
    if row.get("km") is None or row["km"] < 0:
        out.append("type:km")
    if row.get("seller_type") not in {"dealer", "private", ""}:
        out.append("enum:seller_type")
    if row.get("status") not in {"listed", "removed"}:
        out.append("enum:status")
    if row.get("drive") not in {"", "RWD", "FWD", "AWD"}:
        out.append("enum:drive")
    return out


def price_in_band(row: dict[str, Any], ctx: ValidationContext) -> list[str]:
    """Asking price within [0.25, 4] x the cohort prior value, when a prior exists."""
    if ctx.prior_value is None or row.get("ask_ore") is None or row.get("km") is None:
        return []
    vid = row.get("variant_id")
    try:
        year = int(str(row.get("model_year")))
    except (TypeError, ValueError):
        return []
    if not vid:
        return []
    prior = ctx.prior_value(str(vid), year, int(row["km"]))
    if not prior:
        return []
    ratio = row["ask_ore"] / prior
    return (
        [] if PRICE_BAND[0] <= ratio <= PRICE_BAND[1] else [f"range:price_vs_prior({ratio:.2f}x)"]
    )


def km_plausible(row: dict[str, Any], ctx: ValidationContext) -> list[str]:
    """km <= 60 000 x age_years + 15 000."""
    try:
        year = int(str(row.get("model_year")))
    except (TypeError, ValueError):
        return []
    if row.get("km") is None:
        return []
    age = max(age_years(year, ctx.as_of), 0.0)
    limit = KM_PER_YEAR_MAX * age + KM_SLACK
    return [] if row["km"] <= limit else [f"range:km_vs_age({row['km']} > {int(limit)})"]


def range_vs_battery(row: dict[str, Any], ctx: ValidationContext) -> list[str]:
    """WLTP range per kWh between 3 and 9 when both are present."""
    rng = parse_decimal(row.get("range_km_wltp"))
    bat = parse_decimal(row.get("battery_kwh"))
    if rng is None or bat is None or bat <= 0:
        return []
    per = float(rng) / float(bat)
    return (
        [] if RANGE_PER_KWH[0] <= per <= RANGE_PER_KWH[1] else [f"range:range_per_kwh({per:.1f})"]
    )


LISTING_RULES: tuple[Rule, ...] = (
    required_fields,
    field_types,
    price_in_band,
    km_plausible,
    range_vs_battery,
)

NEW_PRICE_REQUIRED = ("model_year", "list_price_nok_incl_vat", "valid_from")
LEASE_REQUIRED = ("term_months", "km_per_year_cap", "monthly_nok", "date")
IDENTITY_FIELDS = ("make", "model")  # plus a trim column, unless variant_id is given


def _identity_missing(row: dict[str, Any], trim_keys: tuple[str, ...]) -> list[str]:
    """Rows name the car either by `variant_id` or by make + model + trim."""
    if str(row.get("variant_id") or "").strip():
        return []
    out = [f"missing:{k}" for k in IDENTITY_FIELDS if str(row.get(k) or "").strip() == ""]
    if not any(str(row.get(k) or "").strip() for k in trim_keys):
        out.append(f"missing:{trim_keys[0]}")
    return out


def new_price_required(row: dict[str, Any], ctx: ValidationContext) -> list[str]:
    out = _identity_missing(row, ("trim_group",))
    out += [f"missing:{k}" for k in NEW_PRICE_REQUIRED if str(row.get(k) or "").strip() == ""]
    if not out:
        if parse_nok_to_ore(row.get("list_price_nok_incl_vat")) in (None, 0):
            out.append("type:list_price_nok_incl_vat")
        try:
            date.fromisoformat(str(row.get("valid_from")))
        except ValueError:
            out.append("type:valid_from")
    return out


def lease_required(row: dict[str, Any], ctx: ValidationContext) -> list[str]:
    out = _identity_missing(row, ("trim", "trim_group"))
    out += [f"missing:{k}" for k in LEASE_REQUIRED if str(row.get(k) or "").strip() == ""]
    if not out:
        for k in ("term_months", "km_per_year_cap"):
            if parse_decimal(row.get(k)) is None:
                out.append(f"type:{k}")
        if parse_nok_to_ore(row.get("monthly_nok")) in (None, 0):
            out.append("type:monthly_nok")
    return out


NEW_PRICE_RULES: tuple[Rule, ...] = (new_price_required,)
LEASE_RULES: tuple[Rule, ...] = (lease_required,)


def validate_rows(
    rows: list[dict[str, Any]], rules: tuple[Rule, ...], ctx: ValidationContext
) -> tuple[list[dict[str, Any]], list[QuarantinedRow]]:
    ok: list[dict[str, Any]] = []
    bad: list[QuarantinedRow] = []
    for row in rows:
        failures: list[str] = []
        for rule in rules:
            failures.extend(rule(row, ctx))
        if failures:
            bad.append(QuarantinedRow(row, failures))
        else:
            ok.append(row)
    return ok, bad


def empty_rates(rows: list[dict[str, Any]], fields: list[str] | None = None) -> dict[str, float]:
    """Share of rows with an empty value per field (health check input)."""
    if not rows:
        return {}
    keys = fields or sorted({k for r in rows for k in r.keys()})
    return {
        k: sum(1 for r in rows if str(r.get(k) if r.get(k) is not None else "").strip() == "")
        / len(rows)
        for k in keys
    }
