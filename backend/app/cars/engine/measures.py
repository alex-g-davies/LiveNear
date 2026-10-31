"""The five cost measures on the deterministic (P50) path, integer øre (R3).

    TCO(t) = Σ_{k≤t} CF_k + X(t) + C_opp(t)
    NPC(t) = Σ_{k≤t} CF_k / g_k + X(t) / g_t          (no C_opp: discounting covers it)
    C_opp(t) = Σ_{k<t} CF_k · (g_{t-k} − 1),  g_m = (1 + r)^{m/12}

where X(t) is the exit-term total (resale value enters negative). Cost per
month = TCO(t) / t, cost per km = TCO(t) / km(t), cash up front = CF_0.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from .models import MONTHS
from .money import share
from .schedule import Schedule

MEASURES = ("per_month", "tco", "npc", "cash_up_front", "per_km")
_CENT = Decimal("1")


def growth_factors(return_pct: Decimal) -> list[Decimal]:
    """g_m = (1 + r)^{m/12} for m = 0..60, exact Decimal arithmetic."""
    base = Decimal(1) + Decimal(return_pct) / Decimal(100)
    return [base ** (Decimal(m) / Decimal(12)) for m in range(MONTHS)]


def _q(x: Decimal) -> int:
    return int(x.quantize(_CENT, rounding=ROUND_HALF_UP))


@dataclass
class Deterministic:
    cum_cf: list[int]
    exit_total: list[int]
    opportunity: list[int]
    tco: list[int]
    npc: list[int]
    per_month: list[int]
    per_km: list[int]
    cash_up_front: int

    def measure(self, name: str) -> list[int]:
        if name == "cash_up_front":
            return [self.cash_up_front] * MONTHS
        return getattr(self, name)


def deterministic_measures(s: Schedule, return_pct: Decimal) -> Deterministic:
    cf = s.cash_total()
    x = s.exit_total()
    g = growth_factors(return_pct)
    cum = [0] * MONTHS
    run = 0
    for k in range(MONTHS):
        run += cf[k]
        cum[k] = run
    opp = [0] * MONTHS
    for t in range(1, MONTHS):
        total = Decimal(0)
        for k in range(t):
            if cf[k]:
                total += Decimal(cf[k]) * (g[t - k] - 1)
        opp[t] = _q(total)
    tco = [cum[t] + x[t] + opp[t] for t in range(MONTHS)]
    disc_cum = [0] * MONTHS
    run_d = Decimal(0)
    for k in range(MONTHS):
        run_d += Decimal(cf[k]) / g[k]
        disc_cum[k] = _q(run_d)
    npc = [disc_cum[t] + _q(Decimal(x[t]) / g[t]) for t in range(MONTHS)]
    per_month = [tco[0]] + [share(tco[t], 1, t) for t in range(1, MONTHS)]
    per_km = [0] + [share(tco[t], 1, s.km_at[t]) if s.km_at[t] else 0 for t in range(1, MONTHS)]
    return Deterministic(cum, x, opp, tco, npc, per_month, per_km, cf[0])


def expected(values: list[int], odds: dict[int, int]) -> int:
    """Σ p(t)·value(t) with p in whole percent."""
    total = Decimal(0)
    for t, p in odds.items():
        total += Decimal(values[t]) * Decimal(p) / Decimal(100)
    return _q(total)


def best_worst(values: list[int], odds: dict[int, int]) -> tuple[tuple[int, int], tuple[int, int]]:
    pts = [(values[t], t) for t, p in odds.items() if p > 0]
    lo = min(pts)
    hi = max(pts)
    return (lo[1], lo[0]), (hi[1], hi[0])
