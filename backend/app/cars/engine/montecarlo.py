"""Uncertainty bands by Monte Carlo (spec 022 R4).

This is the only module in the engine that uses floats. The integer schedule
is converted to float64 once (exact: øre amounts are far below 2^53) and
every uncertain input enters as a per-draw factor on a precomputed base
vector, so all work is broadcasting over `(draws, 61)` arrays.

Streams: user-level factors (loan rate, charging prices, drift) come from a
stream shared by all options; idiosyncratic factors (resale residual,
insurance) come from a per-option stream derived from the option id, so
adding an option never changes another option's draws.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from decimal import Decimal

import numpy as np

from .models import MONTHS
from .schedule import Schedule

Z80 = 1.2815515655446004  # Φ⁻¹(0.9): a P10–P90 band spans ±1.28σ


@dataclass(frozen=True)
class Forced:
    """Pin a factor instead of drawing it (used for the sensitivity panel)."""

    insurance_z: float | None = None
    loan_rate_z: float | None = None
    price_z: float | None = None
    resale_z: float | None = None
    drift_z: float | None = None


def _option_seed(seed: int, option_id: str) -> int:
    h = hashlib.sha256(f"{seed}:{option_id}".encode()).digest()
    return int.from_bytes(h[:8], "big")


def _lognormal_factor(
    value: float, rng: tuple[Decimal, Decimal] | None, z: np.ndarray
) -> np.ndarray:
    """Multiplicative factor with median 1 and P10–P90 matching `rng`/value."""
    if rng is None or value <= 0 or rng[0] <= 0:
        return np.ones_like(z)
    sigma = float(np.log(float(rng[1]) / float(rng[0]))) / (2 * Z80)
    return np.exp(sigma * z)


def _normal_shift(rng: tuple[Decimal, Decimal] | None, z: np.ndarray) -> np.ndarray:
    """Additive shift with mean 0 and P10–P90 half-width from `rng`."""
    if rng is None:
        return np.zeros_like(z)
    sigma = (float(rng[1]) - float(rng[0])) / (2 * Z80)
    return sigma * z


def _annuity(
    principal: float, rate_pct: np.ndarray, n: int, fee: float
) -> tuple[np.ndarray, np.ndarray]:
    """Vectorised payment vector (D, 61) and balance-after-month (D, 61)."""
    d = rate_pct.shape[0]
    pay = np.zeros((d, MONTHS))
    bal = np.zeros((d, MONTHS))
    if principal <= 0 or n <= 0:
        return pay, bal
    i = np.maximum(rate_pct, 0.0) / 100.0 / 12.0
    k = np.arange(MONTHS)[None, :]
    with np.errstate(divide="ignore", invalid="ignore"):
        f = (1 + i[:, None]) ** np.minimum(k, n)
        pmt = np.where(i > 0, principal * i * (1 + i) ** n / ((1 + i) ** n - 1), principal / n)
        balance = np.where(
            i[:, None] > 0,
            principal * f - pmt[:, None] * (f - 1) / np.where(i[:, None] > 0, i[:, None], 1),
            principal - pmt[:, None] * np.minimum(k, n),
        )
    balance = np.where(k >= n, 0.0, np.maximum(balance, 0.0))
    paying = (k >= 1) & (k <= n)
    pay = np.where(paying, pmt[:, None] + fee, 0.0)
    bal = balance
    return pay, bal


@dataclass
class Simulation:
    tco: np.ndarray  # (D, 61)
    npc: np.ndarray
    per_month: np.ndarray
    per_km: np.ndarray
    cash_up_front: np.ndarray  # (D,)

    def measure(self, name: str) -> np.ndarray:
        if name == "cash_up_front":
            return np.repeat(self.cash_up_front[:, None], MONTHS, axis=1)
        return getattr(self, name)


def simulate(
    s: Schedule,
    return_pct: Decimal,
    draws: int,
    seed: int,
    forced: Forced | None = None,
) -> Simulation:
    b = s.bases
    forced = forced or Forced()
    shared = np.random.default_rng(seed)
    own = np.random.default_rng(_option_seed(seed, s.option.id))

    def z(stream: np.random.Generator, pinned: float | None) -> np.ndarray:
        arr = stream.standard_normal(draws)
        return np.full(draws, pinned) if pinned is not None else arr

    z_rate = z(shared, forced.loan_rate_z)
    z_home = z(shared, forced.price_z)
    z_pub = z(shared, forced.price_z)
    z_drift = z(shared, forced.drift_z)
    # Drawn last on the shared stream so electric cars' draws are unchanged (029).
    z_fuel = z(shared, forced.price_z)
    z_ins = z(own, forced.insurance_z)
    z_res = z(own, forced.resale_z)

    # Fixed cash flows: everything except insurance, energy and loan payments.
    fixed = np.zeros(MONTHS)
    for it in s.cash_items():
        if it.key not in ("insurance", "energy", "loan_payments"):
            fixed += np.asarray(it.ore, dtype=np.float64)
    ins = np.asarray(b.insurance_base, dtype=np.float64)
    kwh_home = np.asarray([float(v) for v in b.kwh_home])
    kwh_pub = np.asarray([float(v) for v in b.kwh_public])

    cf = (
        fixed[None, :]
        + ins[None, :] * _lognormal_factor(b.insurance_value, b.insurance_range, z_ins)[:, None]
    )
    cf = (
        cf
        + kwh_home[None, :]
        * (b.home_price_ore * _lognormal_factor(b.home_price_ore, b.home_range, z_home))[:, None]
    )
    cf = (
        cf
        + kwh_pub[None, :]
        * (b.public_price_ore * _lognormal_factor(b.public_price_ore, b.public_range, z_pub))[
            :, None
        ]
    )

    if b.fuel_price_ore > 0:
        litres = np.asarray([float(v) for v in b.litres])
        cf = (
            cf
            + litres[None, :]
            * (b.fuel_price_ore * _lognormal_factor(b.fuel_price_ore, b.fuel_range, z_fuel))[
                :, None
            ]
        )

    payoff = np.zeros((draws, MONTHS))
    if b.loan_principal > 0 and b.loan_rate_pct is not None:
        rate = float(b.loan_rate_pct) + _normal_shift(b.loan_rate_range, z_rate)
        pay, payoff = _annuity(
            float(b.loan_principal), rate, b.loan_term, float(b.loan_monthly_fee)
        )
        cf = cf + pay

    # Exit terms: deterministic ones straight from the schedule, resale and
    # friction re-drawn.
    exit_fixed = np.zeros(MONTHS)
    for it in s.exit_items():
        if it.key not in ("resale_value", "exit_friction", "loan_payoff"):
            exit_fixed += np.asarray(it.ore, dtype=np.float64)
    if s.option.deal.mode == "lease":
        exit_fixed += np.asarray(s.items["exit_friction"].ore, dtype=np.float64)
        resale = np.zeros((draws, MONTHS))
        friction = np.zeros((draws, MONTHS))
    else:
        assert b.resale_p50 is not None and b.resale_log_sigma is not None
        p50 = np.asarray(b.resale_p50, dtype=np.float64)
        sig = np.asarray(b.resale_log_sigma, dtype=np.float64)
        drift = (float(b.drift_pct) + _normal_shift(b.drift_range, z_drift)) / 100.0
        months = np.arange(MONTHS)[None, :] / 12.0
        resale = p50[None, :] * np.exp(sig[None, :] * z_res[:, None] + drift[:, None] * months)
        resale[:, 0] = p50[0]
        friction = resale * float(b.friction_pct)
        friction[:, 0] = 0.0
    exit_total = exit_fixed[None, :] + payoff - resale + friction

    r = float(return_pct) / 100.0
    m = np.arange(MONTHS)
    g = (1.0 + r) ** (m / 12.0)
    # G[k, t] = g_{t-k} - 1 for k < t, else 0
    diff = m[None, :] - m[:, None]
    growth = np.where(diff > 0, (1.0 + r) ** (np.maximum(diff, 0) / 12.0) - 1.0, 0.0)
    cum = np.cumsum(cf, axis=1)
    opp = cf @ growth
    tco = cum + exit_total + opp
    npc = np.cumsum(cf / g[None, :], axis=1) + exit_total / g[None, :]
    t = np.maximum(m, 1)[None, :]
    per_month = tco / t
    per_month[:, 0] = tco[:, 0]
    km = np.asarray(s.km_at, dtype=np.float64)
    with np.errstate(divide="ignore", invalid="ignore"):
        per_km = np.where(km[None, :] > 0, tco / km[None, :], 0.0)
    return Simulation(tco, npc, per_month, per_km, cf[:, 0])


def percentiles(arr: np.ndarray) -> tuple[list[int], list[int], list[int]]:
    """P10/P50/P90 along the draw axis, rounded to øre."""
    p = np.percentile(arr, [10, 50, 90], axis=0)
    return (
        [int(v) for v in np.rint(p[0])],
        [int(v) for v in np.rint(p[1])],
        [int(v) for v in np.rint(p[2])],
    )


def expected_draws(arr: np.ndarray, odds: dict[int, int]) -> np.ndarray:
    """Per-draw expected value Σ p(t)·M_d(t)."""
    w = np.zeros(MONTHS)
    for t_, p in odds.items():
        w[t_] = p / 100.0
    return arr @ w
