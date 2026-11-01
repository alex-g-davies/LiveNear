"""Load the committed bundle (and private listings) into memory (spec 022 R9).

Mirrors `app/data_loader.py`: read once, cache, `clear_cache()` for tests.
Listings come from the owner's R2 bucket when `CARS_R2_*` is configured,
else from the committed synthetic fixture in local dev, else nowhere
(production without credentials reports `unavailable`, never a fake).
"""

from __future__ import annotations

import csv
import hashlib
import logging
import os
from dataclasses import dataclass, field
from datetime import date
from functools import lru_cache
from pathlib import Path

from .bundle_schema import (
    BundleMeta,
    CohortPoint,
    LeaseOfferRecord,
    ListingsMode,
    MarketModelParams,
    NewPriceRecord,
    RatesRecord,
    VariantRecord,
)
from .engine.money import nok

logger = logging.getLogger(__name__)

BUNDLE_DIR = Path(__file__).resolve().parents[2] / "data" / "cars"
FIXTURE_LISTINGS = BUNDLE_DIR / "fixtures" / "listings_fixture.csv"


class BundleError(RuntimeError):
    pass


@dataclass(frozen=True)
class Listing:
    listing_id: str  # sha256 of ad id/url (and reg number if given), hex[:16]
    variant_id: str
    model_year: int
    snapshot_date: date
    ask_ore: int
    km: int
    seller_type: str
    first_reg_month: str | None
    status: str


@dataclass
class Bundle:
    meta: BundleMeta
    vehicles: list[VariantRecord]
    cohorts: list[CohortPoint]
    market: MarketModelParams
    new_prices: list[NewPriceRecord]
    lease_offers: list[LeaseOfferRecord]
    rates: RatesRecord
    listings: list[Listing] = field(default_factory=list)
    listings_mode: ListingsMode = "unavailable"

    def vehicle(self, variant_id: str) -> VariantRecord:
        for v in self.vehicles:
            if v.variant_id == variant_id:
                return v
        raise KeyError(variant_id)

    def new_price(self, variant_id: str, model_year: int) -> NewPriceRecord | None:
        hits = [
            p for p in self.new_prices if p.variant_id == variant_id and p.model_year == model_year
        ]
        return max(hits, key=lambda p: p.valid_from) if hits else None

    def lease_offers_for(self, variant_id: str) -> list[LeaseOfferRecord]:
        return [o for o in self.lease_offers if o.variant_id == variant_id]

    def cohort(self, cohort_id: str) -> CohortPoint | None:
        return next((c for c in self.cohorts if c.cohort_id == cohort_id), None)

    def listings_for(self, cohort_id: str) -> list[Listing]:
        variant_id, _, year = cohort_id.rpartition(":")
        return [
            x for x in self.listings if x.variant_id == variant_id and x.model_year == int(year)
        ]


def _read_json(path: Path) -> object:
    import json

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise BundleError(f"bundle file missing: {path.name}") from exc


def hash_listing_id(
    ad_id_or_url: str, reg_number: str | None = None, salt: str | None = None
) -> str:
    salt = salt if salt is not None else os.getenv("CARS_HASH_SALT", "livenear-cars")
    raw = f"{salt}|{ad_id_or_url.strip()}|{(reg_number or '').strip().upper()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def parse_listings_csv(text: str, vehicles: list[VariantRecord]) -> list[Listing]:
    """Parse the owner's listings CSV (contract in docs/cars/sources.md) into
    hashed listing rows. Rows that cannot be mapped to a variant are skipped
    here; the ingestion runner is where they are quarantined with reasons."""
    by_key: dict[tuple[str, str, str], str] = {
        (v.make.lower(), v.model.lower(), v.trim_group.lower()): v.variant_id for v in vehicles
    }
    out: list[Listing] = []
    for row in csv.DictReader(text.splitlines()):
        variant_id = row.get("variant_id") or by_key.get(
            (
                (row.get("make") or "").strip().lower(),
                (row.get("model") or "").strip().lower(),
                (row.get("trim_group") or row.get("trim_as_listed") or "").strip().lower(),
            )
        )
        if not variant_id:
            continue
        try:
            out.append(
                Listing(
                    listing_id=hash_listing_id(row["ad_id_or_url"], row.get("reg_number")),
                    variant_id=variant_id,
                    model_year=int(row["model_year"]),
                    snapshot_date=date.fromisoformat(row["snapshot_date"]),
                    ask_ore=nok(row["asking_price_nok"]),
                    km=int(float(row["km"])),
                    seller_type=(row.get("seller_type") or "private").strip().lower(),
                    first_reg_month=(row.get("first_reg_month") or None),
                    status=(row.get("status") or "listed").strip().lower(),
                )
            )
        except (KeyError, ValueError):
            continue
    return out


def _load_listings(
    vehicles: list[VariantRecord], production: bool
) -> tuple[list[Listing], ListingsMode]:
    from .ingest.r2 import configured, environ

    if configured():
        try:
            from .ingest.r2 import download_text

            text = download_text(environ().get("CARS_R2_LISTINGS_KEY") or "listings/listings.csv")
            return parse_listings_csv(text, vehicles), "r2"
        except Exception as exc:  # noqa: BLE001 - report, never crash startup
            logger.warning("cars: R2 listings unavailable (%s)", exc)
            return [], "unavailable"
    if production:
        return [], "unavailable"
    if FIXTURE_LISTINGS.exists():
        return parse_listings_csv(FIXTURE_LISTINGS.read_text(encoding="utf-8"), vehicles), "fixture"
    return [], "unavailable"


@lru_cache(maxsize=1)
def get_bundle(bundle_dir: Path = BUNDLE_DIR, production: bool | None = None) -> Bundle:
    if production is None:
        production = bool(os.getenv("STATIC_DIR", "").strip())
    meta = BundleMeta.model_validate(_read_json(bundle_dir / "meta.json"))
    vehicles = [VariantRecord.model_validate(x) for x in _read_json(bundle_dir / "vehicles.json")]
    cohorts = [CohortPoint.model_validate(x) for x in _read_json(bundle_dir / "cohorts.json")]
    market = MarketModelParams.model_validate(_read_json(bundle_dir / "market_model.json"))
    new_prices = [
        NewPriceRecord.model_validate(x) for x in _read_json(bundle_dir / "new_prices.json")
    ]
    leases = [
        LeaseOfferRecord.model_validate(x) for x in _read_json(bundle_dir / "lease_offers.json")
    ]
    rates = RatesRecord.model_validate(_read_json(bundle_dir / "rates.json"))
    listings, mode = _load_listings(vehicles, production)
    return Bundle(meta, vehicles, cohorts, market, new_prices, leases, rates, listings, mode)


def clear_cache() -> None:
    get_bundle.cache_clear()
