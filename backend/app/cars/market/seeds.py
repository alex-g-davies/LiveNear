"""Load the hand-maintained seed inputs under data/cars/seed/ (spec 022 R9).

Seeds are the owner's catalogue and defaults: vehicles.yaml, rates.yaml,
new_prices.csv, lease_quotes.csv and retention_priors.yaml. They are
placeholders flagged `estimate` until real sources replace them. The bundle
builder (`market/bundle.py`) turns seeds plus (optionally) fitted cohorts
into the committed bundle.
"""

from __future__ import annotations

import csv
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

import yaml

from ..bundle_schema import (
    EarlyExitRecord,
    LeaseOfferRecord,
    MarketModelParams,
    NewPriceRecord,
    RatesRecord,
    SegmentParams,
    VariantParams,
    VariantRecord,
)
from ..engine.models import In, Range
from ..engine.money import nok

SEED_DIR = Path(__file__).resolve().parents[3] / "data" / "cars" / "seed"


def _d(x: Any) -> Decimal:
    return Decimal(str(x))


def _date(x: Any) -> date:
    return x if isinstance(x, date) else date.fromisoformat(str(x))


def seed_in(
    block: dict[str, Any], id: str, as_of: date, money: bool = False, kind: type = int
) -> In:
    """Seed blocks omit `as_of` (the file's date applies) and write money in NOK."""
    raw = block["value"]
    if money:
        value: Any = nok(_d(raw))
        rng = block.get("range")
        rng = Range(low=Decimal(nok(_d(rng[0]))), high=Decimal(nok(_d(rng[1])))) if rng else None
    else:
        value = _d(raw) if kind is Decimal else (kind(raw) if kind is not str else str(raw))
        rng = block.get("range")
        rng = Range(low=_d(rng[0]), high=_d(rng[1])) if rng else None
    return In(
        id=block.get("id", id),
        value=value,
        source=str(block["source"]),
        as_of=_date(block.get("as_of", as_of)),
        status=block.get("status", "live"),
        basis=block.get("basis"),
        range=rng,
    )


def load_vehicles(path: Path = SEED_DIR / "vehicles.yaml") -> list[VariantRecord]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    as_of = _date(data["as_of"])
    defaults = data.get("defaults", {})
    out: list[VariantRecord] = []
    for v in data["variants"]:
        vid = v["variant_id"]

        def pick(key: str, _v: dict[str, Any] = v) -> dict[str, Any]:
            return _v.get(key) or defaults[key]

        def scalar(key: str, _v: dict[str, Any] = v) -> Any:
            return _v[key] if key in _v else defaults[key]

        def optional_money(key: str, _v: dict[str, Any] = v, _vid: str = vid) -> In | None:
            block = _v.get(key, defaults.get(key))
            if not block:
                return None
            return seed_in(block, f"{_vid}.{key.removesuffix('_nok')}", as_of, money=True)

        out.append(
            VariantRecord(
                variant_id=vid,
                make=v["make"],
                model=str(v["model"]),
                trim_group=v["trim_group"],
                segment=v["segment"],
                model_years=tuple(int(y) for y in v["model_years"]),
                energy_type=v.get("energy_type", "ev"),
                drive=v.get("drive", "rwd"),
                body=v.get("body", ""),
                battery_kwh=_d(v["battery_kwh"]) if v.get("battery_kwh") is not None else None,
                power_kw=v.get("power_kw"),
                heat_pump=bool(v.get("heat_pump", True)),
                auto_precondition=bool(v.get("auto_precondition", True)),
                tyre_size=str(v.get("tyre_size", "")),
                weight_kg=v.get("weight_kg"),
                efficiency_wh_per_km=seed_in(
                    pick("efficiency_wh_per_km"), f"{vid}.efficiency", as_of
                ),
                winter_factor=seed_in(
                    pick("winter_factor"), f"{vid}.winter_factor", as_of, kind=Decimal
                ),
                tyre_set_ore=seed_in(pick("tyre_set_nok"), f"{vid}.tyre_set", as_of, money=True),
                tyre_life_km=seed_in(pick("tyre_life_km"), f"{vid}.tyre_life_km", as_of),
                service_interval_months=int(scalar("service_interval_months")),
                service_interval_km=int(scalar("service_interval_km")),
                service_first_months=int(scalar("service_first_months")),
                service_price_ore=seed_in(
                    pick("service_price_nok"), f"{vid}.service_price", as_of, money=True
                ),
                service_first_price_ore=optional_money("service_first_price_nok"),
                service_price_after_7y_ore=optional_money("service_price_after_7y_nok"),
                wear_per_year_ore=seed_in(
                    pick("wear_per_year_nok"), f"{vid}.wear_per_year", as_of, money=True
                ),
                warranty_years=int(v.get("warranty_years", 5)),
                warranty_km=int(v.get("warranty_km", 100_000)),
                fun_score=seed_in(pick("fun_score"), f"{vid}.fun_score", as_of, kind=Decimal),
                range_km_wltp=v.get("range_km_wltp"),
                accel_0_100_s=_d(v["accel_0_100_s"])
                if v.get("accel_0_100_s") is not None
                else None,
            )
        )
    return out


def load_rates(path: Path = SEED_DIR / "rates.yaml") -> RatesRecord:
    d = yaml.safe_load(path.read_text(encoding="utf-8"))
    as_of = _date(d["as_of"])

    def i(key: str, **kw: Any) -> In:
        return seed_in(d[key], f"rates.{key.removesuffix('_nok')}", as_of, **kw)

    return RatesRecord(
        as_of=as_of,
        car_loan_rate_pct=i("car_loan_rate_pct", kind=Decimal),
        home_ore_per_kwh=i("home_ore_per_kwh"),
        public_ore_per_kwh=i("public_ore_per_kwh"),
        new_car_fees_ore=i("new_car_fees_nok", money=True),
        loan_establishment_fee_ore=i("loan_establishment_fee_nok", money=True),
        loan_monthly_fee_ore=i("loan_monthly_fee_nok", money=True),
        dealer_exit_friction_pct=i("dealer_exit_friction_pct", kind=Decimal),
        private_exit_friction_pct=i("private_exit_friction_pct", kind=Decimal),
        dealer_margin_pct=i("dealer_margin_pct", kind=Decimal),
        new_car_delivery_months=i("new_car_delivery_months"),
        rental_per_month_ore=i("rental_per_month_nok", money=True),
        materiality_threshold=i("materiality_threshold", kind=Decimal),
        inspection_fee_ore=i("inspection_fee_nok", money=True),
        wheel_change_ore=i("wheel_change_nok", money=True),
        repair_ev_factor=i("repair_ev_factor", kind=Decimal),
        repair_in_warranty_factor=i("repair_in_warranty_factor", kind=Decimal),
        repair_bands=tuple(
            (int(km), int(ore)) for km, ore in d["repair_allowance"]["bands_ore_per_km"]
        ),
        repair_source=In[str](
            id="rates.repair_allowance",
            value=str(d["repair_allowance"]["source"]),
            source=str(d["repair_allowance"]["source_url"]),
            as_of=as_of,
            status=d["repair_allowance"].get("status", "live"),
            basis=d["repair_allowance"].get("basis"),
        ),
    )


def load_new_prices(path: Path = SEED_DIR / "new_prices.csv") -> list[NewPriceRecord]:
    out: list[NewPriceRecord] = []
    with open(path, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            status = row.get("status") or "live"
            out.append(
                NewPriceRecord(
                    variant_id=row["variant_id"],
                    model_year=int(row["model_year"]),
                    price_ore=In[int](
                        id=f"{row['variant_id']}.{row['model_year']}.new_price",
                        value=nok(_d(row["list_price_nok_incl_vat"])),
                        source=row.get("source_url") or "New-price history CSV",
                        as_of=_date(row["valid_from"]),
                        status=status,
                        basis=row.get("basis") or None,
                    ),
                    valid_from=_date(row["valid_from"]),
                )
            )
    return out


def load_lease_quotes(path: Path = SEED_DIR / "lease_quotes.csv") -> list[LeaseOfferRecord]:
    out: list[LeaseOfferRecord] = []
    with open(path, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            oid = row["offer_id"]
            as_of = _date(row["date"])
            status = row.get("status") or "live"
            basis = row.get("basis") or None

            def m(key: str, col: str, _row: dict[str, Any] = row) -> In[int]:
                # A per-column `<col>_status` / `<col>_basis` overrides the
                # offer-wide status, so a quoted rent can be live while an
                # unquoted fee stays an estimate with its own basis.
                return In[int](
                    id=f"{_row['offer_id']}.{key}",
                    value=nok(_d(_row[col])),
                    source=_row["source"],
                    as_of=_date(_row["date"]),
                    status=_row.get(f"{col}_status") or _row.get("status") or "live",
                    basis=_row.get(f"{col}_basis") or _row.get("basis") or None,
                )

            terms = (row.get("early_exit_terms") or "default").strip()
            if terms.endswith("%"):
                ee = EarlyExitRecord(
                    kind="percent_of_remaining",
                    percent=In[Decimal](
                        id=f"{oid}.early_exit_pct",
                        value=_d(terms.rstrip("%")),
                        source=row["source"],
                        as_of=as_of,
                        status=status,
                        basis=basis,
                    ),
                )
            else:
                ee = EarlyExitRecord(
                    kind="default_estimate",
                    recovery_pct=In[Decimal](
                        id=f"{oid}.early_exit_recovery",
                        value=Decimal(60),
                        source="Build spec default rule",
                        as_of=as_of,
                        status="estimate",
                        basis=(
                            "Lessee owes remaining payments less what the lessor "
                            "recovers by re-leasing"
                        ),
                    ),
                )
            includes = tuple(x.strip() for x in (row.get("includes") or "").split("|") if x.strip())
            out.append(
                LeaseOfferRecord(
                    offer_id=oid,
                    variant_id=row["variant_id"],
                    model_year=int(row["model_year"]),
                    term_months=int(row["term_months"]),
                    monthly_ore=m("monthly", "monthly_nok"),
                    upfront_ore=m("upfront", "upfront_nok"),
                    fees_ore=m("fees", "fees_nok"),
                    km_cap_per_year=In[int](
                        id=f"{oid}.km_cap",
                        value=int(row["km_per_year_cap"]),
                        source=row["source"],
                        as_of=as_of,
                        status=status,
                        basis=basis,
                    ),
                    excess_km_fee_ore=m("excess_km_fee", "excess_km_fee_nok"),
                    includes=includes,  # type: ignore[arg-type]
                    early_exit=ee,
                    end_of_lease_fee_ore=m("end_fee", "end_of_lease_fee_nok"),
                    delivery_months=In[int](
                        id=f"{oid}.delivery_months",
                        value=int(row.get("delivery_months") or 0),
                        source=row["source"],
                        as_of=as_of,
                        status=status,
                        basis=basis,
                    ),
                    source=row["source"],
                    as_of=as_of,
                    status=status,  # type: ignore[arg-type]
                )
            )
    return out


def load_retention_priors(
    vehicles: list[VariantRecord],
    new_prices: list[NewPriceRecord],
    path: Path = SEED_DIR / "retention_priors.yaml",
) -> MarketModelParams:
    """Market-model params with NO fitted cohorts: segment priors only."""
    d = yaml.safe_load(path.read_text(encoding="utf-8"))
    as_of = _date(d["as_of"])
    segments = {k: SegmentParams(**v) for k, v in d["segments"].items()}
    prices: dict[str, dict[int, int]] = {}
    for p in new_prices:
        prices.setdefault(p.variant_id, {})[p.model_year] = p.price_ore.value
    variants = {
        v.variant_id: VariantParams(
            segment=v.segment, new_price_by_year=prices.get(v.variant_id, {})
        )
        for v in vehicles
    }
    return MarketModelParams(
        as_of=as_of,
        version="priors-v0",
        segments=segments,
        variants=variants,
        dealer_premium=seed_in(d["dealer_premium"], "market.dealer_premium", as_of, kind=Decimal),
        used_price_drift=seed_in(
            d["used_price_drift_pct"], "market.used_price_drift", as_of, kind=Decimal
        ),
        ask_to_sale_discount=seed_in(
            d["ask_to_sale_discount_pct"], "market.ask_to_sale_discount", as_of, kind=Decimal
        ),
        status=d.get("status", "estimate"),
        note=d.get("note", ""),
    )
