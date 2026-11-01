"""Segment retention curves from fitted cohort values (spec 022 R7).

    r_c = exp(alpha_c) / (new_price(variant, model_year) * adjustment)
    log r = a_s + b_s * age_years + c_s * log(ref_km + KM_OFFSET)

`c_s` is NOT fitted here: it is tied to the segment's pooled within-cohort
mileage slope `beta_bar` (identified on hundreds of listings). Across the
handful of cohort points per segment, age and median km are nearly
collinear, and a free three-coefficient WLS split the depreciation between
them arbitrarily (positive km coefficients on real data, 2026-11-01). With c
fixed, a and b come from a WLS of `log r - c * log(ref_km + KM_OFFSET)` on
`[1, age]`, weights n_c. `age_years` is the time from 1 July of the model
year to `as_of`. A segment with fewer than 4 fitted cohorts also gets the
prior curve as pseudo observations (weight 1 each, an age x km grid) so a
and b stay identified; with no fitted cohorts the prior stands unchanged.
If the fitted b comes out positive (value rising with age) it is clamped to
0 and noted in the report.

Per variant, `shift` is the shrunk mean residual n/(n + 5) * mean_resid,
with n the variant's total listing count across its fitted cohorts.

CPI / VAT adjustment: `PriceAdjustment(variant_id, model_year) -> float`
multiplies the new price before the ratio. The default returns 1.0: the
seed new-price history is "as sold, incl. VAT" and no CPI series is wired
yet (SSB CPI arrives through the ingest runner; the hook is where it plugs in).

SegmentParams output: a, b, c from the WLS; sigma_resid = robust sd of the
fitted cohorts' residuals (floor 0.05, prior when < 2 cohorts);
sigma_per_year keeps the prior unless >= 12 weekly snapshots exist (then it
is still the prior in v1, documented, because a per-horizon forecast error
needs the temporal backtest to reach 100 removed listings); beta_logkm is the
segment's pooled within-cohort slope.
"""

from __future__ import annotations

import math
import warnings
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import date
from typing import TYPE_CHECKING

import numpy as np

from ..bundle_schema import MarketModelParams, NewPriceRecord, SegmentParams, VariantRecord
from .design import ref_logkm, retention_design
from .schema import KM_OFFSET, age_years

if TYPE_CHECKING:
    from .fit import CohortEstimate

PriceAdjustment = Callable[[str, int], float]
MIN_COHORTS_FOR_FIT = 4
SHIFT_SHRINK_N = 5
SIGMA_RESID_FLOOR = 0.05
MIN_SNAPSHOTS_SIGMA_PER_YEAR = 12
PSEUDO_AGES = (0.5, 1.5, 2.5, 3.5, 4.5, 5.5)
PSEUDO_KM_PER_YEAR = (8_000, 15_000, 25_000)


def no_adjustment(variant_id: str, model_year: int) -> float:
    return 1.0


@dataclass(frozen=True)
class RetentionObs:
    variant_id: str
    model_year: int
    segment: str
    age: float
    logkm: float
    log_r: float
    n: int
    pseudo: bool = False


def new_price_map(
    new_prices: Iterable[NewPriceRecord], priors: MarketModelParams
) -> dict[tuple[str, int], int]:
    """Latest new price per (variant, model year); the priors' map fills gaps."""
    best: dict[tuple[str, int], tuple[date, int]] = {}
    for p in new_prices:
        k = (p.variant_id, p.model_year)
        if k not in best or p.valid_from > best[k][0]:
            best[k] = (p.valid_from, p.price_ore.value)
    out = {k: v[1] for k, v in best.items()}
    for vid, vp in priors.variants.items():
        for year, price in vp.new_price_by_year.items():
            out.setdefault((vid, int(year)), price)
    return out


def observations(
    estimates: Iterable[CohortEstimate],
    prices: dict[tuple[str, int], int],
    as_of: date,
    adjustment: PriceAdjustment,
) -> list[RetentionObs]:
    out: list[RetentionObs] = []
    for e in estimates:
        c = e.cohort
        price = prices.get((c.variant_id, c.model_year))
        if not price or not math.isfinite(e.alpha):
            continue
        log_r = e.alpha - math.log(price * adjustment(c.variant_id, c.model_year))
        out.append(
            RetentionObs(
                c.variant_id,
                c.model_year,
                c.segment,
                age_years(c.model_year, as_of),
                ref_logkm(c.ref_km),
                log_r,
                c.n,
            )
        )
    return out


def prior_pseudo_observations(
    segment: str, prior: SegmentParams, c: float | None = None
) -> list[RetentionObs]:
    """The prior curve on an age x km grid, evaluated with the km coefficient
    the fit will use (`c`, default the prior's own) so the pseudo points pull
    a and b towards the prior rather than towards a different km slope."""
    c = prior.c if c is None else c
    out: list[RetentionObs] = []
    for age in PSEUDO_AGES:
        for kpy in PSEUDO_KM_PER_YEAR:
            lkm = math.log(kpy * age + KM_OFFSET)
            out.append(
                RetentionObs(
                    "prior", 0, segment, age, lkm, prior.a + prior.b * age + c * lkm, 1, True
                )
            )
    return out


def _wls(obs: list[RetentionObs], c: float) -> tuple[float, float] | None:
    """WLS of log r - c * logkm on [1, age] -> (a, b); None if not identified."""
    import statsmodels.api as sm

    y = np.array([o.log_r - c * o.logkm for o in obs])
    X = retention_design([o.age for o in obs], [o.logkm for o in obs])[:, :2]
    w = np.array([o.n for o in obs], dtype=float)
    if np.linalg.matrix_rank(X) < 2:
        return None
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        res = sm.WLS(y, X, weights=w).fit()
    a, b = (float(v) for v in res.params)
    if not all(math.isfinite(v) for v in (a, b)):
        return None
    return a, b


def km_coefficient(seg: str, prior: SegmentParams, beta_bar: dict[str, float]) -> float:
    """The retention km coefficient: the pooled within-cohort slope when it
    has the expected sign, else the prior's c."""
    c = beta_bar.get(seg)
    return float(c) if c is not None and math.isfinite(c) and c < 0 else prior.c


def fit_retention(
    estimates: Iterable[CohortEstimate],
    vehicles: list[VariantRecord],
    new_prices: list[NewPriceRecord],
    priors: MarketModelParams,
    as_of: date,
    beta_bar: dict[str, float],
    n_snapshots: int,
    adjustment: PriceAdjustment | None = None,
) -> tuple[dict[str, SegmentParams], dict[str, float], list[str]]:
    """(segment params, variant shifts, notes)."""
    adjustment = adjustment or no_adjustment
    prices = new_price_map(new_prices, priors)
    obs = observations(estimates, prices, as_of, adjustment)
    segments: dict[str, SegmentParams] = {}
    shifts: dict[str, float] = {}
    notes: list[str] = []
    seg_names = sorted(set(priors.segments) | {v.segment for v in vehicles})
    for seg in seg_names:
        prior = priors.segments.get(seg)
        real = [o for o in obs if o.segment == seg]
        if prior is None:
            prior = SegmentParams(
                a=0.737, b=-0.11, c=-0.08, sigma_resid=0.10, sigma_per_year=0.08, beta_logkm=-0.08
            )
            notes.append(f"segment {seg}: no prior in retention_priors.yaml, generic prior used")
        if not real:
            segments[seg] = SegmentParams(
                **{**prior.model_dump(), "beta_logkm": beta_bar.get(seg, prior.beta_logkm)}
            )
            continue
        use = list(real)
        c = km_coefficient(seg, prior, beta_bar)
        if len(real) < MIN_COHORTS_FOR_FIT:
            use += prior_pseudo_observations(seg, prior, c)
            notes.append(
                f"segment {seg}: {len(real)} fitted cohort(s) < {MIN_COHORTS_FOR_FIT}, "
                "prior pseudo-observations added"
            )
        coef = _wls(use, c)
        if coef is None:
            segments[seg] = SegmentParams(
                **{**prior.model_dump(), "beta_logkm": beta_bar.get(seg, prior.beta_logkm)}
            )
            notes.append(f"segment {seg}: retention WLS not identified, prior kept")
            continue
        a, b = coef
        if b > 0:
            notes.append(f"segment {seg}: fitted age slope b={b:.3f} > 0, clamped to 0")
            b = 0.0
        resid = np.array([o.log_r - (a + b * o.age + c * o.logkm) for o in real])
        if resid.size >= 2:
            mad = float(1.4826 * np.median(np.abs(resid - np.median(resid))))
            sigma_resid = max(mad, SIGMA_RESID_FLOOR)
        else:
            sigma_resid = max(prior.sigma_resid, SIGMA_RESID_FLOOR)
        segments[seg] = SegmentParams(
            a=a,
            b=b,
            c=c,
            sigma_resid=sigma_resid,
            sigma_per_year=prior.sigma_per_year,
            beta_logkm=beta_bar.get(seg, prior.beta_logkm),
        )
        # Variant shifts: n-weighted mean residual, shrunk by n/(n+5).
        per_variant: dict[str, tuple[float, int]] = {}
        for o, r in zip(real, resid, strict=True):
            s, n = per_variant.get(o.variant_id, (0.0, 0))
            per_variant[o.variant_id] = (s + r * o.n, n + o.n)
        for vid, (s, n) in per_variant.items():
            if n > 0:
                shifts[vid] = (n / (n + SHIFT_SHRINK_N)) * (s / n)
    if n_snapshots >= MIN_SNAPSHOTS_SIGMA_PER_YEAR:
        notes.append("sigma_per_year kept at the prior (v1 does not fit horizon error)")
    return segments, shifts, notes
