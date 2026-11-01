"""Convert the owner's marketplace exports into the module's CSV contracts
(spec 022 R8). Contracts: docs/cars/sources.md.

The owner hands over three private exports (kept under
data/cars/private/, never committed):

* a used-listings export with the owner's own cohort labels
  (`cohort`, `trim_match`) -> the **listings** contract;
* a private-lease offer export -> the **lease_quotes** contract;
* a new / near-new stock export -> the **new_prices** contract, but only for
  cars in `new` condition and only as dealer asking prices. These are NOT
  manufacturer list prices and are written `status: estimate`.

Nothing here fetches anything; it only re-shapes files the owner provides.
Rows are mapped to catalogue variants explicitly (`variant_id`), so the
ingest runner's validation and quarantine still apply downstream.
"""

from __future__ import annotations

import csv
import io
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from ..bundle_schema import VariantRecord

# Owner's cohort labels (listings export) -> catalogue variant ids.
COHORT_TO_VARIANT: dict[str, str] = {
    "M3 RWD 2021-2023": "tesla-model3-rwd",
    "M3 RWD Highland 2024": "tesla-model3-rwd-highland",
    "M3 LR AWD 2019-2020 (used 5+)": "tesla-model3-lr-awd",
    "MY LR AWD 2022-2024": "tesla-modely-lr-awd",
    "Ioniq5 LR RWD 2021-2023": "hyundai-ioniq5-lr-rwd",
    "Enyaq iV80 RWD 2021-2023": "skoda-enyaq-80-rwd",
    "ID.4 Pro RWD 2021-2023": "vw-id4-pro-rwd",
    "Kona Electric 64 2019-2020 (used 5+)": "hyundai-kona-64",
    "MG4 64 2023-2024": "mg-mg4-64",
}


@dataclass(frozen=True)
class TrimRule:
    """Match a free-text trim/spec of (make, model) to a variant, optionally
    only for a model-year window (facelifts are separate variants)."""

    make: str
    model: str
    trim_pattern: str
    variant_id: str
    year_min: int = 0
    year_max: int = 9999

    def matches(self, make: str, model: str, trim: str, year: int) -> bool:
        return (
            _norm(make) == self.make
            and _norm(model).replace(" ", "") == self.model.replace(" ", "")
            and re.search(self.trim_pattern, trim, flags=re.IGNORECASE) is not None
            and self.year_min <= year <= self.year_max
        )


# Lease-offer and new-stock exports name cars by free text; these rules map
# the trims the owner's starting list covers. Extend as the catalogue grows.
TRIM_RULES: tuple[TrimRule, ...] = (
    TrimRule("tesla", "model 3", r"^standard\s*(range\s*)?rwd$", "tesla-model3-rwd-highland", 2024),
    TrimRule("tesla", "model y", r"long\s*range\s*awd", "tesla-modely-lr-awd", 2022, 2024),
    TrimRule("tesla", "model y", r"long\s*range\s*awd", "tesla-modely-lr-awd-juniper", 2025),
    TrimRule("mg", "mg4", r"\b64\s*kwh\b", "mg-mg4-64", 2023),
)

LISTING_OUT_COLUMNS = (
    "snapshot_date",
    "ad_id_or_url",
    "variant_id",
    "make",
    "model",
    "trim_as_listed",
    "model_year",
    "first_reg_month",
    "battery_kwh",
    "drive",
    "power_kw_or_hp",
    "km",
    "asking_price_nok",
    "price_basis",
    "rereg_fee_nok",
    "seller_type",
    "location",
    "ex_fleet_or_taxi",
    "warranty_note",
    "heat_pump",
    "reg_number",
    "status",
    "published",
)

LEASE_OUT_COLUMNS = (
    "offer_id",
    "variant_id",
    "model_year",
    "condition",
    "term_months",
    "km_per_year_cap",
    "monthly_nok",
    "upfront_nok",
    "fees_nok",
    "fees_nok_status",
    "fees_nok_basis",
    "excess_km_fee_nok",
    "excess_km_fee_nok_status",
    "excess_km_fee_nok_basis",
    "early_exit_terms",
    "includes",
    "end_of_lease_fee_nok",
    "end_of_lease_fee_nok_status",
    "end_of_lease_fee_nok_basis",
    "delivery_months",
    "source",
    "date",
    "status",
    "basis",
)

NEW_PRICE_OUT_COLUMNS = (
    "variant_id",
    "make",
    "model",
    "trim_group",
    "model_year",
    "list_price_nok_incl_vat",
    "valid_from",
    "source_url",
    "status",
    "basis",
)

NEW_PRICE_BASIS = (
    "Dealer asking price for a new car in stock on the export date; not the manufacturer list price"
)


@dataclass
class Conversion:
    rows: list[dict[str, Any]]
    skipped: Counter = field(default_factory=Counter)

    @property
    def n(self) -> int:
        return len(self.rows)


def _norm(s: Any) -> str:
    return str(s or "").strip().lower()


def _int(s: Any) -> int | None:
    t = str(s or "").strip().replace(" ", "")
    if not t:
        return None
    try:
        return int(float(t))
    except ValueError:
        return None


def read_csv_text(text: str) -> list[dict[str, Any]]:
    return [dict(r) for r in csv.DictReader(io.StringIO(text.lstrip("﻿")))]


def write_csv(rows: list[dict[str, Any]], columns: tuple[str, ...]) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=list(columns), extrasaction="ignore", lineterminator="\n")
    w.writeheader()
    for r in rows:
        w.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in columns})
    return buf.getvalue()


def _catalogue(vehicles: list[VariantRecord] | None) -> dict[str, VariantRecord]:
    return {v.variant_id: v for v in (vehicles or [])}


# ------------------------------------------------------------------ listings


def convert_listings(
    rows: list[dict[str, Any]],
    vehicles: list[VariantRecord] | None = None,
    cohort_map: dict[str, str] | None = None,
) -> Conversion:
    """Owner used-listings export -> listings contract rows.

    Kept: plain sales (`sales_form == sale`) whose `trim_match` is `yes` and
    whose `cohort` label maps to a catalogue variant. The asking price is the
    price **excluding** the re-registration fee when the export has it
    (`price_basis = excl_rereg`), because the engine charges that fee as its
    own line item and a seller never receives it; otherwise the total price
    is kept and marked `incl_rereg`.
    """
    cmap = cohort_map or COHORT_TO_VARIANT
    cat = _catalogue(vehicles)
    out = Conversion([])
    for r in rows:
        if _norm(r.get("sales_form") or "sale") != "sale":
            out.skipped[f"sales_form:{_norm(r.get('sales_form'))}"] += 1
            continue
        match = _norm(r.get("trim_match"))
        if match != "yes":
            out.skipped[f"trim_match:{match or 'blank'}"] += 1
            continue
        vid = cmap.get(str(r.get("cohort") or "").strip())
        if vid is None:
            out.skipped["cohort:unmapped"] += 1
            continue
        if cat and vid not in cat:
            out.skipped[f"variant:not_in_catalogue:{vid}"] += 1
            continue
        excl = _int(r.get("price_excl_rereg"))
        total = _int(r.get("price_nok"))
        ask = excl if excl else total
        if not ask:
            out.skipped["price:missing"] += 1
            continue
        first_reg = str(r.get("first_reg") or "").strip()
        power_hp = _int(r.get("power_hp"))
        v = cat.get(vid)
        out.rows.append(
            {
                "snapshot_date": str(r.get("scraped") or r.get("snapshot_date") or "").strip(),
                "ad_id_or_url": str(r.get("url") or r.get("finn_code") or "").strip(),
                "variant_id": vid,
                "make": v.make if v else str(r.get("make") or "").strip(),
                "model": v.model if v else str(r.get("model") or "").strip(),
                "trim_as_listed": str(r.get("trim_parsed") or r.get("spec") or "").strip(),
                "model_year": str(r.get("model_year") or "").strip(),
                "first_reg_month": first_reg[:7] if re.match(r"^\d{4}-\d{2}", first_reg) else "",
                "battery_kwh": str(r.get("battery_kwh") or "").strip(),
                "drive": str(r.get("drivetrain") or "").strip().upper(),
                "power_kw_or_hp": f"{power_hp} hp" if power_hp else "",
                "km": _int(r.get("mileage_km")),
                "asking_price_nok": ask,
                "price_basis": "excl_rereg" if excl else "incl_rereg",
                "rereg_fee_nok": _int(r.get("rereg_fee")) or "",
                "seller_type": _norm(r.get("seller_type")) or "private",
                "location": str(r.get("location") or "").strip(),
                "ex_fleet_or_taxi": "unknown",
                "warranty_note": "",
                "heat_pump": "unknown",
                "reg_number": "",
                "status": "listed",
                "published": str(r.get("published") or "").strip(),
            }
        )
    return out


# ------------------------------------------------------------------ lease offers


def match_trim(make: str, model: str, trim: str, year: int) -> str | None:
    for rule in TRIM_RULES:
        if rule.matches(make, model, trim, year):
            return rule.variant_id
    return None


def convert_lease_offers(
    rows: list[dict[str, Any]], vehicles: list[VariantRecord] | None = None
) -> Conversion:
    """Owner lease-offer export -> lease_quotes contract rows. Monthly rent,
    term, km cap and upfront are taken as quoted (`live`); fees, the
    excess-km charge and the end-of-lease fee are not in the export and are
    written as flagged estimates with their basis."""
    cat = _catalogue(vehicles)
    out = Conversion([])
    for r in rows:
        year = _int(r.get("model_year")) or 0
        vid = match_trim(str(r.get("make")), str(r.get("model")), str(r.get("trim")), year)
        if vid is None:
            out.skipped["trim:no_catalogue_variant"] += 1
            continue
        if cat and vid not in cat:
            out.skipped[f"variant:not_in_catalogue:{vid}"] += 1
            continue
        monthly = _int(r.get("monthly_nok_incl_vat") or r.get("monthly_nok"))
        term = _int(r.get("term_months"))
        km_cap = _int(r.get("km_per_year") or r.get("km_per_year_cap"))
        if not (monthly and term and km_cap):
            out.skipped["fields:missing"] += 1
            continue
        condition = _norm(r.get("condition")) or "new"
        source = str(r.get("url") or r.get("source") or "owner lease export").strip()
        out.rows.append(
            {
                "offer_id": f"lease-{str(r.get('offer_id') or '').strip()}",
                "variant_id": vid,
                "model_year": year,
                "condition": condition,
                "term_months": term,
                "km_per_year_cap": km_cap,
                "monthly_nok": monthly,
                "upfront_nok": _int(r.get("upfront_nok")) or 0,
                "fees_nok": 0,
                "fees_nok_status": "estimate",
                "fees_nok_basis": "Establishment and invoice fees are not in the offer export; "
                "confirm on the written quote",
                "excess_km_fee_nok": "1.50",
                "excess_km_fee_nok_status": "estimate",
                "excess_km_fee_nok_basis": "Typical Norwegian private-lease excess-km charge; "
                "not in the offer export",
                "early_exit_terms": "default",
                "includes": "",
                "end_of_lease_fee_nok": 0,
                "end_of_lease_fee_nok_status": "estimate",
                "end_of_lease_fee_nok_basis": "Return/inspection fee not in the offer export",
                "delivery_months": 0 if condition == "used" else 1,
                "source": source,
                "date": str(r.get("scraped") or r.get("date") or "").strip(),
                "status": "live",
                "basis": "",
            }
        )
    return out


# ------------------------------------------------------------------ new stock


def convert_new_stock(
    rows: list[dict[str, Any]], vehicles: list[VariantRecord] | None = None
) -> Conversion:
    """Owner new/near-new stock export -> new_prices contract rows, for cars
    in `new` condition that match a catalogue variant. Near-new cars are
    skipped (they are used cars). Every row is `estimate` (dealer ask)."""
    cat = _catalogue(vehicles)
    out = Conversion([])
    for r in rows:
        if _norm(r.get("condition")) != "new":
            out.skipped[f"condition:{_norm(r.get('condition')) or 'blank'}"] += 1
            continue
        year = _int(r.get("model_year")) or 0
        vid = match_trim(str(r.get("make")), str(r.get("model")), str(r.get("spec")), year)
        if vid is None:
            out.skipped["spec:no_catalogue_variant"] += 1
            continue
        if cat and vid not in cat:
            out.skipped[f"variant:not_in_catalogue:{vid}"] += 1
            continue
        price = _int(r.get("price_excl_rereg")) or _int(r.get("price_nok"))
        if not price:
            out.skipped["price:missing"] += 1
            continue
        v = cat.get(vid)
        out.rows.append(
            {
                "variant_id": vid,
                "make": v.make if v else str(r.get("make") or "").strip(),
                "model": v.model if v else str(r.get("model") or "").strip(),
                "trim_group": v.trim_group if v else str(r.get("spec") or "").strip(),
                "model_year": year,
                "list_price_nok_incl_vat": price,
                "valid_from": str(r.get("scraped") or "").strip(),
                "source_url": str(r.get("url") or "").strip(),
                "status": "estimate",
                "basis": NEW_PRICE_BASIS,
            }
        )
    return out


def near_new_summary(rows: list[dict[str, Any]]) -> list[tuple[str, int, int, int, int]]:
    """(variant_id, model_year, n, min ask, max ask) for near-new rows that
    match a catalogue variant: an upper bound on the list price, for the
    owner's eyes when filling the new-price seed."""
    buckets: dict[tuple[str, int], list[int]] = {}
    for r in rows:
        if _norm(r.get("condition")) != "used-near-new":
            continue
        year = _int(r.get("model_year")) or 0
        vid = match_trim(str(r.get("make")), str(r.get("model")), str(r.get("spec")), year)
        price = _int(r.get("price_excl_rereg")) or _int(r.get("price_nok"))
        if vid and price:
            buckets.setdefault((vid, year), []).append(price)
    return [(k[0], k[1], len(v), min(v), max(v)) for k, v in sorted(buckets.items())]
