"""Integer-øre money helpers (spec 022 R3).

One rounding rule for the whole engine: ROUND_HALF_UP to the nearest øre,
applied at the point where a rate or factor meets an amount. Amounts are
plain `int` øre (1 NOK = 100 øre); rates and factors are `Decimal`.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import NewType

Ore = NewType("Ore", int)

ZERO = Ore(0)
_CENT = Decimal("1")


def nok(amount: int | str | Decimal) -> Ore:
    """Whole or fractional NOK -> øre. `nok("12345.50") == 1234550`."""
    return Ore(int((Decimal(amount) * 100).quantize(_CENT, rounding=ROUND_HALF_UP)))


def mul(amount: int, factor: Decimal | int) -> Ore:
    """Multiply øre by a factor, rounding half-up to the øre."""
    return Ore(int((Decimal(amount) * Decimal(factor)).quantize(_CENT, rounding=ROUND_HALF_UP)))


def pct(percent: Decimal | int | str) -> Decimal:
    """`pct("6.5") == Decimal("0.065")`."""
    return Decimal(percent) / Decimal(100)


def share(amount: int, numerator: int, denominator: int) -> Ore:
    """`amount * numerator / denominator`, rounded half-up. Denominator > 0."""
    if denominator <= 0:
        raise ValueError("denominator must be positive")
    return Ore(
        int(
            (Decimal(amount) * Decimal(numerator) / Decimal(denominator)).quantize(
                _CENT, rounding=ROUND_HALF_UP
            )
        )
    )


def to_nok_str(amount: int) -> str:
    """Display helper used only by the CLI: `1234550 -> '12 345,50 kr'`."""
    sign = "-" if amount < 0 else ""
    whole, rest = divmod(abs(int(amount)), 100)
    return f"{sign}{whole:,}".replace(",", " ") + f",{rest:02d} kr"
