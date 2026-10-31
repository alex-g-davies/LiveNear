"""Write the derived data bundle under data/cars/ (spec 022 R9).

`build_bundle()` combines the seed catalogue with a fitted market model (or
the retention priors when no listings have been fitted yet) and writes one
JSON file per entity. The cohort points for the market map come from the
fitted cohorts where they exist and from the priors (n = 0, Estimate)
otherwise, so every variant × model year in the catalogue has a point.

    python -m app.cars.market.bundle            # priors only (no listings)
    python scripts/cars_build_bundle.py --listings listings.csv   # fitted (R7)
"""

from __future__ import annotations

import json
import math
from collections.abc import Iterable
from datetime import date
from pathlib import Path

from ..bundle_schema import (
    BundleMeta,
    CohortPoint,
    LeaseOfferRecord,
    MarketModelParams,
    NewPriceRecord,
    RatesRecord,
    SourceHealth,
    VariantRecord,
)
from . import seeds
from .predict import anchor_value

BUNDLE_DIR = Path(__file__).resolve().parents[3] / "data" / "cars"
Z80 = 1.2815515655446004


def cohort_points(
    vehicles: list[VariantRecord],
    params: MarketModelParams,
    as_of: date,
    mid_year_date: date | None = None,
) -> list[CohortPoint]:
    """One point per variant × model year at a reference km (fitted ref_km or
    15 000 km per year of age for prior-only cohorts)."""
    today = mid_year_date or as_of
    out: list[CohortPoint] = []
    for v in vehicles:
        vp = params.variants[v.variant_id]
        for year in v.model_years:
            fit = vp.cohorts.get(year)
            age_months = max(0, (today.year - year) * 12 + (today.month - 7))
            if fit is not None:
                ref_km = fit.ref_km
                value = int(round(math.exp(fit.alpha)))
                half = Z80 * fit.se_alpha
                n, status, sigma_car = fit.n, fit.status, fit.sigma_car
                note = "" if fit.n >= 5 else f"thin cohort: {fit.n} listings"
            else:
                ref_km = int(round(15_000 * age_months / 12.0))
                value, status, sigma_car = anchor_value(
                    params, v.variant_id, year, age_months, ref_km, dealer=False
                )
                seg = params.segments[vp.segment]
                half = Z80 * seg.sigma_resid
                n, note = 0, "no listings yet: value from the segment retention prior"
            out.append(
                CohortPoint(
                    cohort_id=f"{v.variant_id}:{year}",
                    variant_id=v.variant_id,
                    model_year=year,
                    n_listings=n,
                    ref_km=ref_km,
                    value_ref_ore=value,
                    pi_low_ore=int(round(value * math.exp(-half))),
                    pi_high_ore=int(round(value * math.exp(half))),
                    sigma_car=sigma_car,
                    status=status,
                    as_of=as_of,
                    note=note,
                )
            )
    return out


def _dump(path: Path, obj) -> None:
    if isinstance(obj, list):
        payload = [o.model_dump(mode="json") for o in obj]
    else:
        payload = obj.model_dump(mode="json")
    path.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def fit_params_from_listings(
    listings: Iterable[object],
    vehicles: list[VariantRecord],
    new_prices: list[NewPriceRecord],
    priors: MarketModelParams,
    as_of: date,
) -> MarketModelParams:
    """Fit the eb-v1 market model (R7) from listing rows shaped like
    `data_bundle.Listing` or `market.schema.ListingRow`. Imported lazily so
    the web image never loads statsmodels/pandas."""
    from .fit import fit_market_model

    return fit_market_model(listings, vehicles, new_prices, priors, as_of)


def build_bundle(
    out_dir: Path = BUNDLE_DIR,
    vehicles: list[VariantRecord] | None = None,
    rates: RatesRecord | None = None,
    new_prices: list[NewPriceRecord] | None = None,
    lease_offers: list[LeaseOfferRecord] | None = None,
    params: MarketModelParams | None = None,
    sources: list[SourceHealth] | None = None,
    as_of: date | None = None,
    listings: Iterable[object] | None = None,
    listings_as_of: date | None = None,
) -> BundleMeta:
    """Write the bundle. With `listings` (and no explicit `params`) the market
    model is fitted from them via `fit_params_from_listings`; `listings_as_of`
    is the fit date (defaults to the latest snapshot in the listings, never
    the clock)."""
    vehicles = vehicles or seeds.load_vehicles()
    rates = rates or seeds.load_rates()
    new_prices = new_prices or seeds.load_new_prices()
    lease_offers = lease_offers if lease_offers is not None else seeds.load_lease_quotes()
    priors = seeds.load_retention_priors(vehicles, new_prices)
    if params is None and listings is not None:
        rows = list(listings)
        fit_as_of = listings_as_of or (
            max(r.snapshot_date for r in rows) if rows else priors.as_of  # type: ignore[attr-defined]
        )
        params = fit_params_from_listings(rows, vehicles, new_prices, priors, fit_as_of)
    params = params or priors
    as_of = as_of or max(params.as_of, rates.as_of)
    out_dir.mkdir(parents=True, exist_ok=True)
    meta = BundleMeta(
        bundle_as_of=as_of,
        sources=sources
        or [
            SourceHealth(
                name="seed catalogue", last_fetch=as_of, rows=len(vehicles), status="manual"
            ),
            SourceHealth(
                name="new-price history CSV",
                last_fetch=as_of,
                rows=len(new_prices),
                status="manual",
            ),
            SourceHealth(
                name="lease quotes CSV", last_fetch=as_of, rows=len(lease_offers), status="manual"
            ),
            SourceHealth(
                name="listings CSV",
                rows=sum(c.n for v in params.variants.values() for c in v.cohorts.values()),
                status="manual" if any(v.cohorts for v in params.variants.values()) else "disabled",
                note=""
                if any(v.cohorts for v in params.variants.values())
                else "no listings fitted yet",
            ),
        ],
        note=params.note,
    )
    _dump(out_dir / "meta.json", meta)
    _dump(out_dir / "vehicles.json", vehicles)
    _dump(out_dir / "cohorts.json", cohort_points(vehicles, params, as_of))
    _dump(out_dir / "market_model.json", params)
    _dump(out_dir / "new_prices.json", new_prices)
    _dump(out_dir / "lease_offers.json", lease_offers)
    _dump(out_dir / "rates.json", rates)
    return meta


if __name__ == "__main__":
    m = build_bundle()
    print(f"bundle written to {BUNDLE_DIR} (as of {m.bundle_as_of})")
