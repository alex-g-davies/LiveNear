"""Month index -> calendar date, with no clock (spec 022 R3)."""

from __future__ import annotations

from datetime import date


def add_months(d: date, months: int) -> date:
    """Same day-of-month `months` later, clamped to the month's length."""
    y, m = divmod(d.month - 1 + months, 12)
    year = d.year + y
    month = m + 1
    # clamp day
    for day in (d.day, 30, 29, 28):
        try:
            return date(year, month, day)
        except ValueError:
            continue
    raise ValueError("unreachable")


def days_in_month(d: date) -> int:
    nxt = add_months(date(d.year, d.month, 1), 1)
    return (nxt - date(d.year, d.month, 1)).days
