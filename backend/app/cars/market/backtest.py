"""Backtest of the eb-v1 market model (spec 022 R7).

Leave-one-listing-out CV on the cohort fit set (one row per listing, the
latest `listed` snapshot): for each listing, refit the cohort intercept
without it (cheap approximation: alpha only, beta* and delta kept) and
predict its log ask at its own km. Reported per segment and per age band
(< 2 y, 2-4 y, 4 y+):

* MAPE on price = mean |exp(pred) - ask| / ask
* 80 % PI coverage = share with |resid| <= 1.2816 * sigma_car (single car),
  with a Wilson 95 % interval

When >= 100 listings are `removed` after a cutoff snapshot week w (the
median week), the temporal backtest also runs: fit on rows with
snapshot <= w, predict the last ask of listings removed after w.

Gate: `passes` is False only when the Wilson upper bound of the overall
LOO coverage is below 70 %.
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date

import numpy as np
import pandas as pd

from ..bundle_schema import MarketModelParams, NewPriceRecord, VariantRecord
from .fit import LIVE_N, FitResult, fit_market, robust_mean
from .schema import ListingLike, ListingRow, age_years, listings_frame, rows_from_listings

Z80 = 1.2815515655446004
AGE_BANDS: tuple[tuple[str, float, float], ...] = (
    ("<2y", -math.inf, 2.0),
    ("2-4y", 2.0, 4.0),
    ("4y+", 4.0, math.inf),
)
MIN_REMOVED_FOR_TEMPORAL = 100
GATE_UPPER = 0.70


def wilson(k: int, n: int, z: float = 1.959963984540054) -> tuple[float, float]:
    """Wilson score interval for a proportion k/n."""
    if n <= 0:
        return 0.0, 1.0
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


@dataclass(frozen=True)
class Cell:
    n: int
    mape: float
    coverage: float
    wilson_low: float
    wilson_high: float


def summarise(ape: np.ndarray, covered: np.ndarray) -> Cell:
    n = int(ape.size)
    if n == 0:
        return Cell(0, float("nan"), float("nan"), 0.0, 1.0)
    k = int(covered.sum())
    lo, hi = wilson(k, n)
    return Cell(n, float(np.mean(ape)), k / n, lo, hi)


@dataclass(frozen=True)
class TemporalResult:
    cutoff: date
    n_fit_listings: int
    cell: Cell


@dataclass
class BacktestReport:
    as_of: date
    version: str
    model_status: str
    n_listings: int
    n_cohorts: int
    n_snapshots: int
    overall: Cell
    by_segment: dict[str, Cell]
    by_age_band: dict[str, Cell]
    thin_cohorts: list[tuple[str, int]]  # cohort_id, n (< 5)
    skipped_cohorts: list[str]  # n == 1: nothing to leave out
    temporal: TemporalResult | None
    passes: bool
    notes: list[str] = field(default_factory=list)


def _age_band(age: float) -> str:
    for name, lo, hi in AGE_BANDS:
        if lo <= age < hi:
            return name
    return AGE_BANDS[-1][0]


def loo_predictions(fit: FitResult, as_of: date) -> pd.DataFrame:
    """One row per listing: segment, age band, resid (log), ape, covered."""
    recs = []
    for e in fit.estimates.values():
        c = e.cohort
        if c.n < 2:
            continue
        z = c.y - e.beta * c.x - fit.delta * c.dealer.astype(float)
        band = _age_band(age_years(c.model_year, as_of))
        for i in range(c.n):
            mask = np.arange(c.n) != i
            alpha_i = robust_mean(z[mask])
            pred = alpha_i + e.beta * c.x[i] + fit.delta * float(c.dealer[i])
            resid = c.y[i] - pred
            recs.append(
                {
                    "cohort_id": c.cohort_id,
                    "segment": c.segment,
                    "age_band": band,
                    "resid": resid,
                    "ape": abs(math.exp(pred) - math.exp(c.y[i])) / math.exp(c.y[i]),
                    "covered": abs(resid) <= Z80 * e.sigma_car,
                }
            )
    cols = ["cohort_id", "segment", "age_band", "resid", "ape", "covered"]
    return pd.DataFrame.from_records(recs, columns=cols)


def _cells(df: pd.DataFrame, by: str) -> dict[str, Cell]:
    out: dict[str, Cell] = {}
    if df.empty:
        return out
    for key, g in df.groupby(by, sort=True):
        out[str(key)] = summarise(g["ape"].to_numpy(float), g["covered"].to_numpy(bool))
    if by == "age_band":  # youngest first, not alphabetical
        order = [name for name, _, _ in AGE_BANDS]
        out = {k: out[k] for k in order if k in out}
    return out


def temporal_backtest(
    rows: list[ListingRow],
    vehicles: list[VariantRecord],
    new_prices: list[NewPriceRecord],
    priors: MarketModelParams,
    as_of: date,
) -> TemporalResult | None:
    frame = listings_frame(rows)
    if frame.empty:
        return None
    dates = sorted(frame["snapshot_date"].unique())
    if len(dates) < 3:
        return None
    cutoff = dates[len(dates) // 2]
    last = frame.sort_values("snapshot_date").groupby("listing_id").tail(1)
    removed = last[(last["status"] == "removed") & (last["snapshot_date"] > cutoff)]
    if len(removed) < MIN_REMOVED_FOR_TEMPORAL:
        return None
    train = [r for r in rows if r.snapshot_date <= cutoff]
    if not train:
        return None
    fit = fit_market(train, vehicles, new_prices, priors, cutoff)
    ape, cov = [], []
    for r in removed.itertuples(index=False):
        e = fit.estimates.get((r.variant_id, int(r.model_year)))
        if e is None:
            continue
        x = math.log(r.km + 1000.0) - math.log(e.cohort.ref_km + 1000.0)
        pred = e.alpha + e.beta * x + fit.delta * float(r.dealer)
        resid = r.y - pred
        ape.append(abs(math.exp(pred) - r.ask_ore) / r.ask_ore)
        cov.append(abs(resid) <= Z80 * e.sigma_car)
    return TemporalResult(
        cutoff, fit.n_listings, summarise(np.array(ape), np.array(cov, dtype=bool))
    )


def run_backtest(
    listings: Iterable[ListingLike | ListingRow],
    vehicles: list[VariantRecord],
    new_prices: list[NewPriceRecord],
    priors: MarketModelParams,
    as_of: date,
) -> tuple[BacktestReport, FitResult]:
    rows = rows_from_listings(listings)
    fit = fit_market(rows, vehicles, new_prices, priors, as_of)
    preds = loo_predictions(fit, as_of)
    overall = summarise(preds["ape"].to_numpy(float), preds["covered"].to_numpy(bool))
    thin = sorted(
        ((e.cohort.cohort_id, e.n) for e in fit.estimates.values() if e.n < LIVE_N),
        key=lambda t: t[0],
    )
    skipped = sorted(e.cohort.cohort_id for e in fit.estimates.values() if e.n < 2)
    temporal = temporal_backtest(rows, vehicles, new_prices, priors, as_of)
    notes = list(fit.notes)
    if temporal is None:
        notes.append(
            f"temporal backtest skipped: fewer than {MIN_REMOVED_FOR_TEMPORAL} listings removed "
            "after the cutoff week"
        )
    report = BacktestReport(
        as_of=as_of,
        version=fit.params.version,
        model_status=fit.params.status,
        n_listings=fit.n_listings,
        n_cohorts=len(fit.estimates),
        n_snapshots=fit.n_snapshots,
        overall=overall,
        by_segment=_cells(preds, "segment"),
        by_age_band=_cells(preds, "age_band"),
        thin_cohorts=thin,
        skipped_cohorts=skipped,
        temporal=temporal,
        passes=overall.n > 0 and overall.wilson_high >= GATE_UPPER,
        notes=notes,
    )
    return report, fit
