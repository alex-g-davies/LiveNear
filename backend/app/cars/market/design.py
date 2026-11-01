"""Design matrices and transforms shared by the fit, retention and backtest
modules (spec 022 R7). Pure numpy."""

from __future__ import annotations

import math

import numpy as np

from .constants import KM_OFFSET


def logkm(km: np.ndarray | float | int) -> np.ndarray:
    return np.log(np.asarray(km, dtype=float) + KM_OFFSET)


def ref_logkm(ref_km: int) -> float:
    return math.log(ref_km + KM_OFFSET)


def centred_logkm(km: np.ndarray, ref_km: int) -> np.ndarray:
    """x = log(km + KM_OFFSET) - log(ref_km + KM_OFFSET), so the intercept is the log
    price at `ref_km`."""
    return logkm(km) - ref_logkm(ref_km)


def slope_design(x: np.ndarray) -> np.ndarray:
    """[1, x] for the per-cohort robust regression."""
    x = np.asarray(x, dtype=float)
    return np.column_stack([np.ones_like(x), x])


def dealer_design(dealer: np.ndarray) -> np.ndarray:
    """[1, dealer] for the pooled dealer-premium regression."""
    d = np.asarray(dealer, dtype=float)
    return np.column_stack([np.ones_like(d), d])


def retention_design(age: np.ndarray, lkm: np.ndarray) -> np.ndarray:
    """[1, age_years, log(km + KM_OFFSET)] for the segment retention WLS."""
    age = np.asarray(age, dtype=float)
    lkm = np.asarray(lkm, dtype=float)
    return np.column_stack([np.ones_like(age), age, lkm])
