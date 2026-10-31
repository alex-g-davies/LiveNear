"""Reconcile parsed rows with the catalogue (spec 022 R8).

* `map_variant`: by (make, model, trim_group | trim_as_listed), else by the
  Vegvesen-derived buckets battery kWh (+/- 5), drive and power kW (+/- 15 %)
  when they identify exactly one variant of that make and model.
* `hash_identity`: `listing_id = hash_listing_id(ad_id_or_url, reg_number)`;
  the clear-text `reg_number` (and any `vin`) is dropped from the row.
* `dedupe`: one row per (listing_id, snapshot_date), the last one wins.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from ..bundle_schema import VariantRecord
from ..data_bundle import hash_listing_id
from .validate import QuarantinedRow, parse_decimal

IDENTIFIER_FIELDS = ("reg_number", "vin")


def _norm(s: Any) -> str:
    return str(s or "").strip().lower()


def variant_index(vehicles: Iterable[VariantRecord]) -> dict[tuple[str, str, str], str]:
    return {(_norm(v.make), _norm(v.model), _norm(v.trim_group)): v.variant_id for v in vehicles}


def map_variant(row: dict[str, Any], vehicles: list[VariantRecord]) -> str | None:
    explicit = _norm(row.get("variant_id"))
    if explicit and any(v.variant_id == explicit for v in vehicles):
        return explicit
    idx = variant_index(vehicles)
    make, model = _norm(row.get("make")), _norm(row.get("model"))
    for trim_key in ("trim_group", "trim_as_listed", "trim"):
        hit = idx.get((make, model, _norm(row.get(trim_key))))
        if hit:
            return hit
    # Bucket match on technical data (Vegvesen or the owner's columns).
    bat = parse_decimal(row.get("battery_kwh"))
    power = row.get("power_kw")
    drive = _norm(row.get("drive"))
    candidates = []
    for v in vehicles:
        if _norm(v.make) != make or _norm(v.model) != model:
            continue
        if (
            bat is not None
            and v.battery_kwh is not None
            and abs(float(bat) - float(v.battery_kwh)) > 5
        ):
            continue
        if drive and v.drive != drive:
            continue
        if power and v.power_kw and abs(int(power) - v.power_kw) > 0.15 * v.power_kw:
            continue
        candidates.append(v.variant_id)
    if len(candidates) == 1 and (bat is not None or power or drive):
        return candidates[0]
    return None


def hash_identity(row: dict[str, Any], salt: str | None = None) -> dict[str, Any]:
    out = dict(row)
    out["listing_id"] = hash_listing_id(
        str(row.get("ad_id_or_url", "")), row.get("reg_number"), salt=salt
    )
    for k in IDENTIFIER_FIELDS:
        out.pop(k, None)
    return out


def dedupe(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: dict[tuple[str, str], dict[str, Any]] = {}
    for r in rows:
        seen[(str(r["listing_id"]), str(r["snapshot_date"]))] = r
    return list(seen.values())


def reconcile_listings(
    rows: list[dict[str, Any]], vehicles: list[VariantRecord], salt: str | None = None
) -> tuple[list[dict[str, Any]], list[QuarantinedRow]]:
    """Map to variants, hash identities, drop clear-text identifiers, dedupe.
    Rows without a variant are quarantined with `reconcile:unknown_variant`."""
    ok: list[dict[str, Any]] = []
    bad: list[QuarantinedRow] = []
    for r in rows:
        vid = map_variant(r, vehicles)
        if vid is None:
            bad.append(
                QuarantinedRow(
                    {k: v for k, v in r.items() if k not in IDENTIFIER_FIELDS},
                    ["reconcile:unknown_variant"],
                )
            )
            continue
        hashed = hash_identity(r, salt=salt)
        hashed["variant_id"] = vid
        ok.append(hashed)
    return dedupe(ok), bad
