"""Seeded synthetic listings with known parameters (spec 022 R7, R12).

Used by the fixture under data/cars/fixtures/, by the parameter-recovery
tests and by the committed backtest report. The generator is pure: it takes
the catalogue, new prices, priors, a seed and an `as_of` date.

Truth per cohort (variant x model year), with age measured at `as_of`:

    km_ref     = km_per_year(variant) * age            (variants differ, so age
                                                        and km are not collinear
                                                        across cohorts)
    log level  = log(new price) + a + b * age + c * log(km_ref + 1000)   (prior curve)
    log ask    = level + beta * (log(km + 1000) - log(km_ref + 1000))
                 + delta * dealer + N(0, sigma_car)

Ads appear in one of the first three weekly snapshots, keep their asking
price, and are removed each week with probability `removal_hazard`; the
removal week's row carries status `removed` and an ask lowered by
`last_ask_discount`. No registration numbers are generated.
"""

from __future__ import annotations

import csv
import io
import math
from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np

from ..bundle_schema import MarketModelParams, NewPriceRecord, VariantRecord
from .schema import KM_OFFSET, age_years

CSV_COLUMNS = (
    "snapshot_date",
    "ad_id_or_url",
    "make",
    "model",
    "trim_as_listed",
    "trim_group",
    "model_year",
    "first_reg_month",
    "battery_kwh",
    "drive",
    "power_kw_or_hp",
    "km",
    "asking_price_nok",
    "seller_type",
    "location",
    "ex_fleet_or_taxi",
    "warranty_note",
    "heat_pump",
    "reg_number",
    "status",
)
KM_PER_YEAR_CYCLE = (9_000, 13_000, 17_000, 22_000)
LOCATIONS = ("Oslo", "Bergen", "Trondheim", "Stavanger", "Drammen", "Kristiansand")


@dataclass(frozen=True)
class CohortTruth:
    variant_id: str
    model_year: int
    segment: str
    km_ref: int
    log_level: float  # private-seller log ask (øre) at km_ref
    beta: float

    def log_price(self, km: float) -> float:
        return self.log_level + self.beta * (
            math.log(km + KM_OFFSET) - math.log(self.km_ref + KM_OFFSET)
        )


@dataclass
class SyntheticTruth:
    as_of: date
    beta: float
    sigma_car: float
    dealer_premium: float
    last_ask_discount: float
    cohorts: dict[tuple[str, int], CohortTruth] = field(default_factory=dict)
    km_per_year: dict[str, int] = field(default_factory=dict)
    n_listings: int = 0


def _new_price(new_prices: list[NewPriceRecord], variant_id: str, year: int) -> int | None:
    hits = [p for p in new_prices if p.variant_id == variant_id and p.model_year == year]
    return max(hits, key=lambda p: p.valid_from).price_ore.value if hits else None


def generate(
    vehicles: list[VariantRecord],
    new_prices: list[NewPriceRecord],
    priors: MarketModelParams,
    *,
    seed: int = 22,
    as_of: date = date(2026, 10, 31),
    n_per_cohort: int = 12,
    weeks: int = 10,
    beta: float = -0.08,
    sigma_car: float = 0.10,
    dealer_premium: float = 0.06,
    removal_hazard: float = 0.15,
    last_ask_discount: float = 0.02,
    dealer_share: float = 0.5,
) -> tuple[list[dict[str, str]], SyntheticTruth]:
    """Listing rows in the CSV contract (strings) plus the generating truth."""
    rng = np.random.default_rng(seed)
    truth = SyntheticTruth(as_of, beta, sigma_car, dealer_premium, last_ask_discount)
    snapshots = [as_of - timedelta(days=7 * (weeks - 1 - w)) for w in range(weeks)]
    rows: list[dict[str, str]] = []
    counter = 0
    for vi, v in enumerate(vehicles):
        kpy = KM_PER_YEAR_CYCLE[vi % len(KM_PER_YEAR_CYCLE)]
        truth.km_per_year[v.variant_id] = kpy
        seg = priors.segments[v.segment]
        for year in v.model_years:
            price = _new_price(new_prices, v.variant_id, year)
            if price is None:
                continue
            age = max(age_years(year, as_of), 0.25)
            km_ref = int(round(kpy * age))
            level = math.log(price) + seg.a + seg.b * age + seg.c * math.log(km_ref + KM_OFFSET)
            ct = CohortTruth(v.variant_id, year, v.segment, km_ref, level, beta)
            truth.cohorts[(v.variant_id, year)] = ct
            for _ in range(n_per_cohort):
                counter += 1
                truth.n_listings += 1
                km = int(max(500, round(km_ref * math.exp(rng.normal(0.0, 0.35)), -2)))
                dealer = bool(rng.random() < dealer_share)
                log_ask = ct.log_price(km) + dealer_premium * dealer + rng.normal(0.0, sigma_car)
                ask_nok = int(round(math.exp(log_ask) / 100.0, -3))
                start = int(rng.integers(0, min(3, weeks)))
                reg_month = f"{year}-{int(rng.integers(1, 13)):02d}"
                base = {
                    "ad_id_or_url": f"fx-{counter:06d}",
                    "make": v.make,
                    "model": v.model,
                    "trim_as_listed": v.trim_group,
                    "trim_group": v.trim_group,
                    "model_year": str(year),
                    "first_reg_month": reg_month,
                    "battery_kwh": str(v.battery_kwh) if v.battery_kwh is not None else "",
                    "drive": v.drive.upper(),
                    "power_kw_or_hp": f"{v.power_kw} kW" if v.power_kw else "",
                    "km": str(km),
                    "seller_type": "dealer" if dealer else "private",
                    "location": LOCATIONS[int(rng.integers(0, len(LOCATIONS)))],
                    "ex_fleet_or_taxi": "n" if rng.random() < 0.9 else "unknown",
                    "warranty_note": "" if rng.random() < 0.7 else f"Garanti til {year + 5}",
                    "heat_pump": "y" if v.heat_pump else "n",
                    "reg_number": "",
                }
                for w in range(start, weeks):
                    removed = w > start and rng.random() < removal_hazard
                    ask = ask_nok * (1.0 - last_ask_discount) if removed else ask_nok
                    rows.append(
                        {
                            "snapshot_date": snapshots[w].isoformat(),
                            **base,
                            "asking_price_nok": str(int(round(ask, -2))),
                            "status": "removed" if removed else "listed",
                        }
                    )
                    if removed:
                        break
    rows.sort(key=lambda r: (r["snapshot_date"], r["ad_id_or_url"]))
    return rows, truth


def to_csv(rows: list[dict[str, str]]) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=list(CSV_COLUMNS), lineterminator="\n")
    w.writeheader()
    for r in rows:
        w.writerow({k: r.get(k, "") for k in CSV_COLUMNS})
    return buf.getvalue()
