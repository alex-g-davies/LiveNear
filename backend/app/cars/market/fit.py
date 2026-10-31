"""Empirical-Bayes cohort price model, version "eb-v1" (spec 022 R7).

Per cohort c (variant x model year), with y = log(ask øre) and
x = log(km + 1000) centred at the cohort's median km:

    y = alpha_c + beta_c * x + delta * dealer + e,   e ~ (0, sigma_car)

1. Slope. Cohorts with n >= 3 get a robust slope beta_hat (statsmodels RLM,
   Huber-T). The segment slope beta_bar_s is the precision-weighted mean of
   those slopes. Each slope is shrunk toward it:

       beta* = n/(n+kappa) * beta_hat + kappa/(n+kappa) * beta_bar_s

   with kappa = sigma^2 / tau^2 from the method of moments: tau^2 is the
   between-cohort slope variance net of sampling noise (floored), sigma^2 the
   per-observation slope variance n * se^2. kappa is floored at 3. Cohorts
   with n < 3 take beta_bar_s outright.
2. Intercept. alpha_c is the robust mean of y - beta* x - delta * dealer,
   so alpha is the *private-seller* log asking price at ref_km, matching
   `predict.anchor_value`, which adds delta for dealer cars.
3. Dealer premium. delta is the dealer coefficient of a pooled WLS of
   within-cohort residuals; it replaces the seed prior only with >= 20
   dealer and >= 20 private rows (else the prior stays, status estimate).
   Fleet / taxi and warranty terms are NOT fitted in v1: the columns are
   carried through unfitted (documented in docs/cars/backtest.md).
4. Scale. sigma_car is the segment-pooled robust scale (MAD x 1.4826) of the
   within-cohort residuals, blended with the cohort's own scale when the
   cohort has n >= 15 (weight n/(n+15)). se_alpha = sigma_car / sqrt(n).
5. Status. Cohorts with n < 5 are "estimate". The model is "live" only when
   >= 4 variants have a cohort with n >= 5.

Nothing here reads a clock or a file: `as_of`, seeds and priors are inputs.
"""

from __future__ import annotations

import math
import warnings
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

import numpy as np

from ..bundle_schema import (
    CohortFit,
    MarketModelParams,
    NewPriceRecord,
    VariantParams,
    VariantRecord,
)
from ..engine.models import In
from . import bias as bias_mod
from . import retention as retention_mod
from .cohorts import Cohort, CohortKey, build_cohorts, by_segment
from .design import dealer_design, slope_design
from .schema import ListingLike, ListingRow, latest_per_listing, listings_frame, rows_from_listings

VERSION = "eb-v1"
MIN_SLOPE_N = 3  # cohorts below this take the segment slope
LIVE_N = 5  # cohorts below this are "estimate"
LIVE_VARIANTS = 4  # variants with a live cohort needed for a "live" model
SE_FLOOR = 0.02  # floor on a cohort slope's standard error (precision weights)
TAU2_FLOOR = 1e-4  # floor on between-cohort slope variance (tau = 0.01)
KAPPA_FLOOR = 3.0
SIGMA_FLOOR = 0.03  # floor on sigma_car (log points)
SIGMA_BLEND_N = 15  # cohort scale enters the blend from this n
MIN_DEALER_ROWS = 20
MIN_PRIVATE_ROWS = 20


# ------------------------------------------------------------------ robust helpers


def _rlm(y: np.ndarray, X: np.ndarray):
    import statsmodels.api as sm

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return sm.RLM(y, X, M=sm.robust.norms.HuberT()).fit()


def robust_mean(values: np.ndarray) -> float:
    """Huber M-estimate of location; median below 3 points or when the scale
    degenerates (all residuals equal)."""
    v = np.asarray(values, dtype=float)
    if v.size == 0:
        raise ValueError("robust_mean of an empty array")
    if v.size < 3 or np.ptp(v) == 0:
        return float(np.median(v))
    try:
        res = _rlm(v, np.ones((v.size, 1)))
        est = float(res.params[0])
    except Exception:  # noqa: BLE001 - degenerate scale etc.; fall back
        return float(np.median(v))
    return est if math.isfinite(est) else float(np.median(v))


def robust_scale(resid: np.ndarray) -> float:
    """MAD x 1.4826 (consistent for a normal sd)."""
    r = np.asarray(resid, dtype=float)
    if r.size == 0:
        return float("nan")
    return float(1.4826 * np.median(np.abs(r - np.median(r))))


def fit_slope(y: np.ndarray, x: np.ndarray) -> tuple[float, float] | None:
    """Robust (beta_hat, se) of y ~ 1 + x, or None when x does not vary.
    Falls back to OLS if the robust fit does not converge."""
    y = np.asarray(y, dtype=float)
    x = np.asarray(x, dtype=float)
    if y.size < MIN_SLOPE_N or np.ptp(x) < 1e-9:
        return None
    X = slope_design(x)
    try:
        res = _rlm(y, X)
        beta, se = float(res.params[1]), float(res.bse[1])
    except Exception:  # noqa: BLE001
        beta, se = float("nan"), float("nan")
    if not (math.isfinite(beta) and math.isfinite(se)):
        import statsmodels.api as sm

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            ols = sm.OLS(y, X).fit()
        beta, se = float(ols.params[1]), float(ols.bse[1])
        if not math.isfinite(beta):
            return None
        if not math.isfinite(se):
            se = SE_FLOOR
    return beta, max(se, SE_FLOOR)


# ------------------------------------------------------------------ shrinkage


@dataclass(frozen=True)
class SegmentSlope:
    beta_bar: float
    kappa: float
    tau2: float
    n_cohorts: int  # cohorts that contributed a slope
    from_prior: bool


def segment_slope(slopes: list[tuple[float, float, int]], prior_beta: float) -> SegmentSlope:
    """Precision-weighted mean slope and the shrinkage constant kappa from
    `(beta_hat, se, n)` triples. With no slopes the prior stands and kappa is
    infinite (every cohort takes the prior)."""
    if not slopes:
        return SegmentSlope(prior_beta, math.inf, TAU2_FLOOR, 0, True)
    b = np.array([s[0] for s in slopes])
    se2 = np.array([max(s[1], SE_FLOOR) ** 2 for s in slopes])
    n = np.array([s[2] for s in slopes], dtype=float)
    w = 1.0 / se2
    beta_bar = float(np.sum(w * b) / np.sum(w))
    var_b = float(np.sum(w * (b - beta_bar) ** 2) / np.sum(w))
    tau2 = max(var_b - float(np.mean(se2)), TAU2_FLOOR)
    sigma2 = float(np.mean(n * se2))
    kappa = max(sigma2 / tau2, KAPPA_FLOOR)
    return SegmentSlope(beta_bar, kappa, tau2, len(slopes), False)


def shrink(beta_hat: float, n: int, seg: SegmentSlope) -> float:
    if not math.isfinite(seg.kappa):
        return seg.beta_bar
    w = n / (n + seg.kappa)
    return w * beta_hat + (1.0 - w) * seg.beta_bar


# ------------------------------------------------------------------ estimates


@dataclass
class CohortEstimate:
    cohort: Cohort
    beta_hat: float | None
    se_beta: float | None
    beta: float  # beta*, after shrinkage
    alpha: float = float("nan")
    resid: np.ndarray = field(default_factory=lambda: np.zeros(0))
    sigma_car: float = float("nan")
    se_alpha: float = float("nan")

    @property
    def n(self) -> int:
        return self.cohort.n

    @property
    def status(self) -> str:
        return "live" if self.n >= LIVE_N else "estimate"

    def predict(self, x: np.ndarray, dealer: np.ndarray, delta: float) -> np.ndarray:
        return self.alpha + self.beta * np.asarray(x, float) + delta * np.asarray(dealer, float)


def _fit_alpha(est: CohortEstimate, delta: float) -> None:
    c = est.cohort
    z = c.y - est.beta * c.x - delta * c.dealer.astype(float)
    est.alpha = robust_mean(z)
    est.resid = z - est.alpha


def fit_dealer_premium(
    estimates: Iterable[CohortEstimate], delta_prior: float
) -> tuple[float, bool]:
    """(delta, fitted?) from pooled within-cohort residuals. Residuals are
    computed net of the *current* delta, so the dealer coefficient is the
    correction to it; the returned value is the full premium."""
    import statsmodels.api as sm

    ys, ds = [], []
    for e in estimates:
        ys.append(e.resid + delta_prior * e.cohort.dealer.astype(float))
        ds.append(e.cohort.dealer)
    if not ys:
        return delta_prior, False
    y = np.concatenate(ys)
    d = np.concatenate(ds)
    if int(d.sum()) < MIN_DEALER_ROWS or int((~d).sum()) < MIN_PRIVATE_ROWS:
        return delta_prior, False
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        res = sm.WLS(y, dealer_design(d), weights=np.ones_like(y)).fit()
    delta = float(res.params[1])
    return (delta, True) if math.isfinite(delta) else (delta_prior, False)


def _fit_segment(
    cohorts: list[Cohort], prior_beta: float, delta: float
) -> tuple[list[CohortEstimate], SegmentSlope]:
    slopes: list[tuple[float, float, int]] = []
    raw: dict[CohortKey, tuple[float, float] | None] = {}
    for c in cohorts:
        s = fit_slope(c.y, c.x)
        raw[c.key] = s
        if s is not None:
            slopes.append((s[0], s[1], c.n))
    seg = segment_slope(slopes, prior_beta)
    out: list[CohortEstimate] = []
    for c in cohorts:
        s = raw[c.key]
        beta = shrink(s[0], c.n, seg) if s is not None else seg.beta_bar
        est = CohortEstimate(c, s[0] if s else None, s[1] if s else None, beta)
        _fit_alpha(est, delta)
        out.append(est)
    return out, seg


def _df_scaled_resid(e: CohortEstimate) -> np.ndarray:
    """Residuals inflated by sqrt(n / (n - p)) for the p parameters the cohort
    fitted (alpha, plus beta when n >= 3), so the pooled scale is not deflated
    by the degrees of freedom spent. Single-listing cohorts carry no scale
    information and are left out."""
    n = e.n
    if n < 2:
        return np.zeros(0)
    p = 2 if e.beta_hat is not None else 1
    return e.resid * math.sqrt(n / max(n - p, 1))


def _assign_scales(estimates: list[CohortEstimate], prior_sigma: float) -> float:
    pooled = np.concatenate([_df_scaled_resid(e) for e in estimates]) if estimates else np.zeros(0)
    seg_sigma = robust_scale(pooled) if pooled.size >= 3 else float("nan")
    if not math.isfinite(seg_sigma) or seg_sigma < SIGMA_FLOOR:
        seg_sigma = max(prior_sigma, SIGMA_FLOOR) if not math.isfinite(seg_sigma) else SIGMA_FLOOR
    for e in estimates:
        sigma = seg_sigma
        if e.n >= SIGMA_BLEND_N:
            own = robust_scale(_df_scaled_resid(e))
            if math.isfinite(own):
                w = e.n / (e.n + SIGMA_BLEND_N)
                sigma = math.sqrt(w * own**2 + (1 - w) * seg_sigma**2)
        e.sigma_car = max(sigma, SIGMA_FLOOR)
        e.se_alpha = e.sigma_car / math.sqrt(e.n)
    return seg_sigma


# ------------------------------------------------------------------ assembly


@dataclass
class FitResult:
    params: MarketModelParams
    estimates: dict[CohortKey, CohortEstimate]
    segment_slopes: dict[str, SegmentSlope]
    segment_sigma: dict[str, float]
    delta: float
    delta_fitted: bool
    n_listings: int  # distinct listings used by the cohort fit
    n_snapshots: int
    notes: list[str]


def _decimal(x: float, places: int = 4) -> Decimal:
    return Decimal(str(round(x, places)))


def fit_market(
    listings: Iterable[ListingLike | ListingRow],
    vehicles: list[VariantRecord],
    new_prices: list[NewPriceRecord],
    priors: MarketModelParams,
    as_of: date,
    price_adjustment: retention_mod.PriceAdjustment | None = None,
) -> FitResult:
    """Full fit with internals exposed (the backtest needs beta*, delta and
    the per-cohort residual scale). `fit_market_model` returns `.params`."""
    rows = rows_from_listings(listings)
    frame = listings_frame(rows)
    latest = latest_per_listing(frame)
    segment_of = {v.variant_id: v.segment for v in vehicles}
    cohorts = build_cohorts(latest, segment_of)
    n_snapshots = int(frame["snapshot_date"].nunique()) if not frame.empty else 0
    notes: list[str] = []

    delta = float(priors.dealer_premium.value)
    seg_prior = priors.segments
    estimates: dict[CohortKey, CohortEstimate] = {}
    seg_slopes: dict[str, SegmentSlope] = {}
    seg_sigma: dict[str, float] = {}

    def run_pass(delta_now: float) -> None:
        estimates.clear()
        for seg_name, group in by_segment(cohorts).items():
            prior_beta = seg_prior[seg_name].beta_logkm if seg_name in seg_prior else -0.08
            ests, sl = _fit_segment(group, prior_beta, delta_now)
            seg_slopes[seg_name] = sl
            for e in ests:
                estimates[e.cohort.key] = e

    run_pass(delta)
    delta_new, fitted = fit_dealer_premium(estimates.values(), delta)
    if fitted:
        delta = delta_new
        run_pass(delta)
    for seg_name, group in by_segment(cohorts).items():
        prior_sigma = seg_prior[seg_name].sigma_resid if seg_name in seg_prior else 0.10
        seg_sigma[seg_name] = _assign_scales([estimates[c.key] for c in group], prior_sigma)

    dealer_in = (
        In[Decimal](
            id=priors.dealer_premium.id,
            value=_decimal(delta),
            source=f"Pooled dealer term of within-cohort residuals ({VERSION})",
            as_of=as_of,
            status="live",
        )
        if fitted
        else priors.dealer_premium
    )
    if not fitted:
        notes.append(
            f"dealer premium kept at the prior: fewer than {MIN_DEALER_ROWS} dealer or "
            f"{MIN_PRIVATE_ROWS} private rows"
        )

    beta_bar = {s: sl.beta_bar for s, sl in seg_slopes.items()}
    segments, shifts, ret_notes = retention_mod.fit_retention(
        estimates.values(),
        vehicles,
        new_prices,
        priors,
        as_of,
        beta_bar,
        n_snapshots,
        price_adjustment,
    )
    notes.extend(ret_notes)
    bias = bias_mod.fit_bias(frame, segments, vehicles, new_prices, priors, as_of)
    notes.extend(bias.notes)

    prices: dict[str, dict[int, int]] = {}
    for p in new_prices:
        prices.setdefault(p.variant_id, {})[p.model_year] = p.price_ore.value
    variants: dict[str, VariantParams] = {}
    for v in vehicles:
        cohort_fits: dict[int, CohortFit] = {}
        for (vid, year), e in estimates.items():
            if vid != v.variant_id:
                continue
            cohort_fits[year] = CohortFit(
                n=e.n,
                ref_km=e.cohort.ref_km,
                alpha=float(e.alpha),
                beta=float(e.beta),
                se_alpha=float(e.se_alpha),
                sigma_car=float(e.sigma_car),
                status=e.status,  # type: ignore[arg-type]
                as_of=as_of,
            )
        prev = priors.variants.get(v.variant_id)
        variants[v.variant_id] = VariantParams(
            segment=v.segment,
            shift=float(shifts.get(v.variant_id, prev.shift if prev else 0.0)),
            new_price_by_year=prices.get(v.variant_id, prev.new_price_by_year if prev else {}),
            cohorts=dict(sorted(cohort_fits.items())),
        )

    live_variants = sum(
        1 for vp in variants.values() if any(c.n >= LIVE_N for c in vp.cohorts.values())
    )
    status = "live" if live_variants >= LIVE_VARIANTS else "estimate"
    if status == "estimate":
        notes.insert(
            0,
            f"{live_variants} variant(s) have a cohort with >= {LIVE_N} listings; "
            f"{LIVE_VARIANTS} needed for a live model",
        )
    params = MarketModelParams(
        as_of=as_of,
        version=VERSION,
        segments=segments,
        variants=variants,
        dealer_premium=dealer_in,
        used_price_drift=bias.used_price_drift,
        ask_to_sale_discount=bias.ask_to_sale_discount,
        status=status,  # type: ignore[arg-type]
        note="; ".join(notes),
    )
    return FitResult(
        params=params,
        estimates=estimates,
        segment_slopes=seg_slopes,
        segment_sigma=seg_sigma,
        delta=delta,
        delta_fitted=fitted,
        n_listings=int(len(latest)),
        n_snapshots=n_snapshots,
        notes=notes,
    )


def fit_market_model(
    listings: Iterable[ListingLike | ListingRow],
    vehicles: list[VariantRecord],
    new_prices: list[NewPriceRecord],
    priors: MarketModelParams,
    as_of: date,
    price_adjustment: retention_mod.PriceAdjustment | None = None,
) -> MarketModelParams:
    """Listings + catalogue + priors -> `MarketModelParams` (version eb-v1)."""
    return fit_market(listings, vehicles, new_prices, priors, as_of, price_adjustment).params
