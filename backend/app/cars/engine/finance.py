"""Loan arithmetic as pure functions (spec 022 R3, R12).

Convention (documented so the golden case can be matched to the øre):
nominal annual rate, monthly compounding (`i = rate / 12`), payments in
arrears at the end of months 1..n, each month's interest rounded half-up to
the øre, constant payment from the closed-form annuity formula rounded
half-up, and the final payment absorbing the rounding residual so the
balance ends at exactly zero.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from .money import Ore, mul

_CENT = Decimal("1")


@dataclass(frozen=True)
class AmortRow:
    month: int
    payment: Ore
    interest: Ore
    principal: Ore
    balance: Ore  # after this payment


def monthly_rate(annual_rate_pct: Decimal) -> Decimal:
    return Decimal(annual_rate_pct) / Decimal(100) / Decimal(12)


def annuity_payment(principal: int, annual_rate_pct: Decimal, n: int) -> Ore:
    """Constant monthly payment for `principal` øre over `n` months."""
    if n <= 0:
        raise ValueError("term must be positive")
    if principal <= 0:
        return Ore(0)
    i = monthly_rate(annual_rate_pct)
    if i == 0:
        return Ore(int((Decimal(principal) / n).quantize(_CENT, rounding=ROUND_HALF_UP)))
    factor = (1 + i) ** n
    pmt = Decimal(principal) * i * factor / (factor - 1)
    return Ore(int(pmt.quantize(_CENT, rounding=ROUND_HALF_UP)))


def amortise(principal: int, annual_rate_pct: Decimal, n: int) -> list[AmortRow]:
    """Full schedule, months 1..n. Sum of principal parts equals `principal`."""
    if principal <= 0:
        return []
    i = monthly_rate(annual_rate_pct)
    pmt = annuity_payment(principal, annual_rate_pct, n)
    rows: list[AmortRow] = []
    balance = int(principal)
    for k in range(1, n + 1):
        interest = mul(balance, i)
        if k == n:
            principal_part = balance
            payment = Ore(balance + interest)
        else:
            principal_part = Ore(pmt - interest)
            if principal_part > balance:  # cannot overpay before the last month
                principal_part = Ore(balance)
            payment = Ore(principal_part + interest)
        balance -= principal_part
        rows.append(AmortRow(k, payment, interest, principal_part, Ore(balance)))
    return rows


def payoff(rows: list[AmortRow], month: int) -> Ore:
    """Balance remaining right after the payment in `month` (0 = before any)."""
    if month <= 0:
        return Ore(rows[0].balance + rows[0].principal) if rows else Ore(0)
    if month >= len(rows):
        return Ore(0)
    return rows[month - 1].balance
