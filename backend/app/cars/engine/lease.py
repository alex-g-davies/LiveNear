"""Lease rules as pure functions (spec 022 R3).

- Payments: `term` payments at indices 1..term; upfront rent and fees at
  index 0 (delivery day).
- Horizon past the term: the contract repeats on the same terms, including a
  new upfront rent (build spec "Mode rules: lease"); the caller flags months
  past the first term Estimate.
- Excess km at exit month t: `max(0, km(t) - cap * t / term) * fee`, the cap
  pro-rated and reset each term.
- Early exit at month t inside a term: one of three rule shapes; zero at the
  end of a term.
"""

from __future__ import annotations

from decimal import Decimal

from .models import HORIZON_MONTHS, MONTHS, DefaultEarlyExit, FixedTable, PercentOfRemaining
from .money import Ore, mul, pct, share


def lease_payment_schedule(
    monthly: int, upfront: int, fees: int, term: int, pay_in_advance: bool
) -> tuple[list[int], list[bool]]:
    """Cash out per month 0..60 and a per-month flag `beyond_first_term`.

    Index k >= 1 means "during month k"; exiting at t includes months 1..t.
    The first term's upfront rent and fees land at index 0 (delivery day);
    the payment for month k lands at index k. A repeat term starts the month
    after the previous one ends, so its upfront rent lands at index
    `term + 1`, never on an exit exactly at a term end. `pay_in_advance`
    only shifts timing within a month, which this monthly model does not
    resolve; it is kept for documentation of the quote."""
    del pay_in_advance
    cf = [0] * MONTHS
    beyond = [False] * MONTHS
    cf[0] += fees + upfront
    start = 0
    while start < HORIZON_MONTHS:
        if start > 0:
            cf[start + 1] += upfront
            for k in range(start + 1, MONTHS):
                beyond[k] = True
        for k in range(start + 1, min(start + term, HORIZON_MONTHS) + 1):
            cf[k] += monthly
        start += term
    return cf, beyond


def excess_km_charge(km_at: list[int], cap_per_year: int, fee_per_km: int, term: int) -> list[int]:
    """Charge due if the car is returned at month t (0..60)."""
    out = [0] * MONTHS
    for t in range(1, MONTHS):
        months_into_term = ((t - 1) % term) + 1
        km_into_term = km_at[t] - km_at[t - months_into_term]
        allowed = share(cap_per_year * term, months_into_term, 12 * term)
        over = max(0, km_into_term - allowed)
        out[t] = over * fee_per_km
    return out


def early_exit_charge(
    rule: PercentOfRemaining | FixedTable | DefaultEarlyExit,
    monthly: int,
    term: int,
    percent: Decimal | None = None,
    table: dict[int, int] | None = None,
    recovery_pct: Decimal | None = None,
) -> list[int]:
    """Charge if the lease is broken at month t (0..60); zero at term ends.

    The unwrapped values (`percent`, `table`, `recovery_pct`) are passed by
    the caller after recording provenance, so this function stays pure."""
    out = [0] * MONTHS
    for t in range(1, MONTHS):
        into = t % term
        if into == 0:
            continue
        remaining = Ore(monthly * (term - into))
        if isinstance(rule, PercentOfRemaining):
            out[t] = mul(remaining, pct(percent if percent is not None else rule.percent.value))
        elif isinstance(rule, FixedTable):
            tbl = table if table is not None else rule.by_month
            keys = sorted(k for k in tbl if k <= into)
            out[t] = tbl[keys[-1]] if keys else 0
        else:
            rec = recovery_pct if recovery_pct is not None else rule.recovery_pct.value
            out[t] = mul(remaining, Decimal(1) - pct(rec))
    return out
