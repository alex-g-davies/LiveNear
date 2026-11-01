"""Written-down default estimates (spec 022 R5: no silent defaults).

Every value here is an *estimate* with its basis spelled out, so it shows
up as Estimate in the UI until the owner replaces it with a quote. Numbers
are rough Norwegian market orders of magnitude, not sourced rates; the
owner's own quotes override them (open decision 5 in the build spec).
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from .models import In, InsuranceProfile, Range
from .money import mul, nok

INSURANCE_AS_OF = date(2026, 10, 31)
_BASIS = (
    "Rough full-coverage premium for a Norwegian EV by price band, age band and "
    "claims-free years (newcomers start at low bonus). Owner to replace with quotes."
)

# Annual premium by purchase-price band, NOK, for a 30–39-year-old with 5+ claims-free years.
_PRICE_BANDS = [
    (nok(300_000), nok(9_000)),
    (nok(500_000), nok(12_000)),
    (nok(800_000), nok(15_000)),
    (nok(10**9), nok(19_000)),
]
_AGE_FACTOR = {
    "18-24": Decimal("1.8"),
    "25-29": Decimal("1.3"),
    "30-39": Decimal("1.0"),
    "40-49": Decimal("0.9"),
    "50-64": Decimal("0.85"),
    "65+": Decimal("0.9"),
}


def _claims_factor(years: int) -> Decimal:
    if years <= 0:
        return Decimal("1.6")
    if years <= 2:
        return Decimal("1.4")
    if years <= 4:
        return Decimal("1.2")
    if years <= 9:
        return Decimal("1.0")
    return Decimal("0.85")


def default_insurance(profile: InsuranceProfile, price_ore: int, option_id: str) -> In[int]:
    base = next(v for cap, v in _PRICE_BANDS if price_ore <= cap)
    years = profile.claims_free_years
    if profile.has_claims_free_letter:
        years = max(years, 3)  # some insurers accept a foreign letter; conservative credit
    annual = mul(mul(base, _AGE_FACTOR[profile.age_band]), _claims_factor(years))
    return In[int](
        id=f"{option_id}.insurance_annual",
        value=int(annual),
        source="Default estimate (engine/defaults.py)",
        as_of=INSURANCE_AS_OF,
        status="estimate",
        basis=_BASIS,
        range=Range(
            low=Decimal(mul(annual, Decimal("0.7"))), high=Decimal(mul(annual, Decimal("1.4")))
        ),
    )
