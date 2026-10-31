"""Internal row and column contracts for the market fit (spec 022 R7).

Everything downstream of the listings CSV / ingest store speaks these shapes:

`ListingRow`      one listing at one weekly snapshot (money in øre, km int).
`listings_frame`  the pandas frame the fit works on. Columns:

    listing_id     hashed ad id (data_bundle.hash_listing_id)
    variant_id     catalogue variant (cohort key, part 1)
    model_year     int (cohort key, part 2)
    snapshot_date  date of the weekly snapshot
    ask_ore        asking price, integer øre incl. VAT
    km             odometer, km
    seller_type    "dealer" | "private"
    status         "listed" | "removed"
    dealer         bool, seller_type == "dealer"
    y              log(ask_ore), the fit's response
    logkm          log(km + 1000), the fit's mileage regressor (uncentred)
    ex_fleet       bool | None (carried through, not fitted in v1)
    warranty_note  str (carried through, not fitted in v1)

`latest_per_listing` collapses snapshots to one row per listing for the
cross-sectional cohort fit: the most recent *listed* row when one exists,
else the most recent row. Removed rows carry the last (often lowered) ask and
feed the ask-to-sale proxy in `bias.py`, not the asking-price level.
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Protocol

import pandas as pd

LISTING_COLUMNS = (
    "listing_id",
    "variant_id",
    "model_year",
    "snapshot_date",
    "ask_ore",
    "km",
    "seller_type",
    "status",
    "dealer",
    "y",
    "logkm",
    "ex_fleet",
    "warranty_note",
)

KM_OFFSET = 1000.0  # log(km + 1000): keeps 0 km finite and flattens the first few thousand km


class ListingLike(Protocol):
    """Anything shaped like `data_bundle.Listing` (duck-typed, no import)."""

    listing_id: str
    variant_id: str
    model_year: int
    snapshot_date: date
    ask_ore: int
    km: int
    seller_type: str
    status: str
    first_reg_month: str | None


@dataclass(frozen=True)
class ListingRow:
    listing_id: str
    variant_id: str
    model_year: int
    snapshot_date: date
    ask_ore: int
    km: int
    seller_type: str = "private"
    status: str = "listed"
    first_reg_month: str | None = None
    ex_fleet: bool | None = None
    warranty_note: str = ""
    raw: dict[str, Any] = field(default_factory=dict, compare=False, hash=False)


def _flag(value: Any) -> bool | None:
    if value is None:
        return None
    s = str(value).strip().lower()
    if s in {"y", "yes", "true", "1"}:
        return True
    if s in {"n", "no", "false", "0"}:
        return False
    return None


def rows_from_listings(listings: Iterable[ListingLike | ListingRow]) -> list[ListingRow]:
    out: list[ListingRow] = []
    for x in listings:
        if isinstance(x, ListingRow):
            out.append(x)
            continue
        out.append(
            ListingRow(
                listing_id=x.listing_id,
                variant_id=x.variant_id,
                model_year=int(x.model_year),
                snapshot_date=x.snapshot_date,
                ask_ore=int(x.ask_ore),
                km=int(x.km),
                seller_type=(x.seller_type or "private").lower(),
                status=(x.status or "listed").lower(),
                first_reg_month=getattr(x, "first_reg_month", None),
            )
        )
    return out


def rows_from_dicts(rows: Iterable[dict[str, Any]]) -> list[ListingRow]:
    """Rows from the ingest store (`store/listings.csv`): already hashed and
    reconciled, money in øre under `ask_ore`."""
    out: list[ListingRow] = []
    for r in rows:
        snap = r["snapshot_date"]
        out.append(
            ListingRow(
                listing_id=str(r["listing_id"]),
                variant_id=str(r["variant_id"]),
                model_year=int(r["model_year"]),
                snapshot_date=snap if isinstance(snap, date) else date.fromisoformat(str(snap)),
                ask_ore=int(r["ask_ore"]),
                km=int(float(r["km"])),
                seller_type=str(r.get("seller_type") or "private").lower(),
                status=str(r.get("status") or "listed").lower(),
                first_reg_month=(r.get("first_reg_month") or None),
                ex_fleet=_flag(r.get("ex_fleet_or_taxi")),
                warranty_note=str(r.get("warranty_note") or ""),
                raw=dict(r),
            )
        )
    return out


def listings_frame(rows: Iterable[ListingRow]) -> pd.DataFrame:
    recs = []
    for r in rows:
        if r.ask_ore <= 0 or r.km < 0:
            continue
        recs.append(
            {
                "listing_id": r.listing_id,
                "variant_id": r.variant_id,
                "model_year": int(r.model_year),
                "snapshot_date": r.snapshot_date,
                "ask_ore": int(r.ask_ore),
                "km": int(r.km),
                "seller_type": r.seller_type,
                "status": r.status,
                "dealer": r.seller_type == "dealer",
                "y": math.log(r.ask_ore),
                "logkm": math.log(r.km + KM_OFFSET),
                "ex_fleet": r.ex_fleet,
                "warranty_note": r.warranty_note,
            }
        )
    if not recs:
        return pd.DataFrame({c: pd.Series(dtype=object) for c in LISTING_COLUMNS})
    return pd.DataFrame.from_records(recs, columns=list(LISTING_COLUMNS))


def latest_per_listing(frame: pd.DataFrame) -> pd.DataFrame:
    """One row per listing: latest `listed` snapshot if any, else latest row."""
    if frame.empty:
        return frame
    ranked = frame.assign(_listed=(frame["status"] == "listed").astype(int))
    ranked = ranked.sort_values(["listing_id", "_listed", "snapshot_date"])
    out = ranked.groupby("listing_id", sort=False).tail(1).drop(columns="_listed")
    return out.reset_index(drop=True)


def age_years(model_year: int, as_of: date) -> float:
    """Age of a model-year cohort: time since 1 July of the model year."""
    return (as_of - date(int(model_year), 7, 1)).days / 365.25
