"""Market drift and the ask-to-sale proxy from weekly snapshots (spec 022 R7).

Both need the same ads revisited over time. With fewer than `MIN_SNAPSHOTS`
(8) distinct snapshot dates the seed priors are returned unchanged (status
estimate) and the reason is recorded. Otherwise:

* ask-to-sale discount (percent) = 100 * (1 - median(last ask / first ask))
  over listings whose last row is `removed` (needs >= 20 such listings). It
  is a proxy: the last asking price before an ad disappears, not the sale.
* used-price drift (percent per year) = slope over snapshot weeks of the
  weekly mean log retention at fixed age and km, i.e. of
  log(ask) - log(new price) - (b * age + c * log(km + 1000)) using the fitted
  segment curve, over `listed` rows only (a removed row's lowered last ask is
  the sale proxy, not the week's asking level). Rows are weighted
  1 / weeks_seen so long-lived ads do not
  dominate (survivorship weighting; applied only when >= 8 snapshots exist,
  which is the only case where drift is computed at all). The P10-P90 range
  is slope +/- 1.2816 * se.

Status: spec R7 says drift defaults to 0 until 12 weekly snapshots exist, so
fitted values from 8-11 snapshots are reported with status `estimate` and a
basis; from 12 snapshots they are `live`.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

import numpy as np
import pandas as pd

from ..bundle_schema import MarketModelParams, NewPriceRecord, SegmentParams, VariantRecord
from ..engine.models import In, Range
from .schema import age_years

MIN_SNAPSHOTS = 8
LIVE_SNAPSHOTS = 12
MIN_REMOVED = 20
BOOTSTRAP_REPS = 200
BOOTSTRAP_SEED = 22
Z80 = 1.2815515655446004


@dataclass
class BiasResult:
    used_price_drift: In[Decimal]
    ask_to_sale_discount: In[Decimal]
    n_snapshots: int
    n_removed: int = 0
    notes: list[str] = field(default_factory=list)


def _dec(x: float, places: int = 2) -> Decimal:
    return Decimal(str(round(x, places)))


def ask_to_sale_ratio(frame: pd.DataFrame) -> tuple[float | None, int]:
    """(median last/first ask over removed listings, count)."""
    if frame.empty:
        return None, 0
    s = frame.sort_values(["listing_id", "snapshot_date"])
    g = s.groupby("listing_id", sort=False)
    first = g["ask_ore"].first()
    last = g["ask_ore"].last()
    removed = g["status"].last() == "removed"
    ratios = (last[removed] / first[removed]).to_numpy(dtype=float)
    ratios = ratios[np.isfinite(ratios)]
    if ratios.size == 0:
        return None, 0
    return float(np.median(ratios)), int(ratios.size)


def weekly_drift(
    frame: pd.DataFrame,
    segments: dict[str, SegmentParams],
    segment_of: dict[str, str],
    prices: dict[tuple[str, int], int],
    as_of: date,
) -> tuple[float, float] | None:
    """(slope in log points per year, se) of weekly mean log retention."""
    if frame.empty:
        return None
    # Live asks only: a removed row carries the (lowered) last ask, which is
    # the ask-to-sale proxy, not the asking-price level of the week.
    f = frame[frame["variant_id"].isin(segment_of.keys()) & (frame["status"] == "listed")].copy()
    if f.empty:
        return None
    weeks_seen = f.groupby("listing_id")["snapshot_date"].transform("nunique").to_numpy(dtype=float)
    adj = np.empty(len(f))
    keep = np.ones(len(f), dtype=bool)
    for i, (vid, year, y, lkm) in enumerate(
        zip(f["variant_id"], f["model_year"], f["y"], f["logkm"], strict=True)
    ):
        price = prices.get((vid, int(year)))
        seg = segments.get(segment_of[vid])
        if not price or seg is None:
            keep[i] = False
            adj[i] = np.nan
            continue
        adj[i] = y - math.log(price) - (seg.b * age_years(int(year), as_of) + seg.c * lkm)
    keep &= np.isfinite(adj)
    if keep.sum() < 3:
        return None
    adj = adj[keep]
    w = (1.0 / weeks_seen)[keep]
    dates = f["snapshot_date"].to_numpy()[keep]
    uniq_dates, week_idx = np.unique(dates, return_inverse=True)
    if uniq_dates.size < 3:
        return None
    _, listing_idx = np.unique(f["listing_id"].to_numpy()[keep], return_inverse=True)
    t = np.array([(d - uniq_dates[0]).days / 365.25 for d in uniq_dates])

    def slope_for(row_w: np.ndarray) -> float:
        tot = np.bincount(week_idx, weights=row_w, minlength=uniq_dates.size)
        num = np.bincount(week_idx, weights=row_w * adj, minlength=uniq_dates.size)
        ok = tot > 0
        if ok.sum() < 3:
            return float("nan")
        m = num[ok] / tot[ok]
        ww = tot[ok]
        tt = t[ok]
        tbar = np.average(tt, weights=ww)
        mbar = np.average(m, weights=ww)
        var = np.sum(ww * (tt - tbar) ** 2)
        return float(np.sum(ww * (tt - tbar) * (m - mbar)) / var) if var > 0 else float("nan")

    slope = slope_for(w)
    if not math.isfinite(slope):
        return None
    # Listing-level bootstrap: the same ads persist across weeks, so weekly
    # means are autocorrelated and a per-week OLS se would be far too small.
    rng = np.random.default_rng(BOOTSTRAP_SEED)
    n_listings = int(listing_idx.max()) + 1
    reps = []
    for _ in range(BOOTSTRAP_REPS):
        counts = np.bincount(rng.integers(0, n_listings, n_listings), minlength=n_listings)
        reps.append(slope_for(w * counts[listing_idx]))
    reps_arr = np.array([r for r in reps if math.isfinite(r)])
    se = float(np.std(reps_arr, ddof=1)) if reps_arr.size >= 2 else 0.0
    return slope, se


def fit_bias(
    frame: pd.DataFrame,
    segments: dict[str, SegmentParams],
    vehicles: list[VariantRecord],
    new_prices: list[NewPriceRecord],
    priors: MarketModelParams,
    as_of: date,
) -> BiasResult:
    n_snap = int(frame["snapshot_date"].nunique()) if not frame.empty else 0
    drift_in = priors.used_price_drift
    disc_in = priors.ask_to_sale_discount
    notes: list[str] = []
    if n_snap < MIN_SNAPSHOTS:
        notes.append(
            f"drift and ask-to-sale kept at the priors: {n_snap} weekly snapshot(s) "
            f"< {MIN_SNAPSHOTS}"
        )
        return BiasResult(drift_in, disc_in, n_snap, 0, notes)

    status = "live" if n_snap >= LIVE_SNAPSHOTS else "estimate"
    basis = (
        None if status == "live" else f"fitted from {n_snap} weekly snapshots (< {LIVE_SNAPSHOTS})"
    )

    ratio, n_removed = ask_to_sale_ratio(frame)
    if ratio is None or n_removed < MIN_REMOVED:
        notes.append(
            f"ask-to-sale kept at the prior: {n_removed} removed listing(s) < {MIN_REMOVED}"
        )
    else:
        disc_in = In[Decimal](
            id=priors.ask_to_sale_discount.id,
            value=_dec(100.0 * (1.0 - ratio)),
            source=f"Median last/first ask of {n_removed} removed listings (proxy for sale price)",
            as_of=as_of,
            status=status,
            basis=basis or "last asking price before removal is a proxy, not a transaction price",
        )

    from .retention import new_price_map

    prices = new_price_map(new_prices, priors)
    segment_of = {v.variant_id: v.segment for v in vehicles}
    d = weekly_drift(frame, segments, segment_of, prices, as_of)
    if d is None:
        notes.append("drift kept at the prior: fewer than 3 usable weekly means")
    else:
        slope, se = d
        drift_in = In[Decimal](
            id=priors.used_price_drift.id,
            value=_dec(100.0 * slope),
            source=f"Slope of weekly mean log retention over {n_snap} snapshots, 1/weeks weights",
            as_of=as_of,
            status=status,
            basis=basis,
            range=Range(
                low=_dec(100.0 * (slope - Z80 * se)), high=_dec(100.0 * (slope + Z80 * se))
            ),
        )
    return BiasResult(drift_in, disc_in, n_snap, n_removed, notes)
