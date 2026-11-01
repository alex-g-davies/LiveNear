"""Cohorts = (variant_id, model_year) built from the per-listing frame
(spec 022 R7). Mid-year splits are the catalogue's job: a facelift that
changes the market (e.g. Model 3 Highland) is its own variant_id, so no
split table is needed here."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .design import centred_logkm

CohortKey = tuple[str, int]


@dataclass
class Cohort:
    variant_id: str
    model_year: int
    segment: str
    ids: np.ndarray  # listing ids (object)
    y: np.ndarray  # log ask øre
    km: np.ndarray  # int km
    dealer: np.ndarray  # bool
    ref_km: int  # cohort median km, the intercept's reference point
    x: np.ndarray  # log(km+1000) - log(ref_km+1000)

    @property
    def n(self) -> int:
        return int(self.y.size)

    @property
    def key(self) -> CohortKey:
        return (self.variant_id, self.model_year)

    @property
    def cohort_id(self) -> str:
        return f"{self.variant_id}:{self.model_year}"


def build_cohorts(latest: pd.DataFrame, segment_of: dict[str, str]) -> dict[CohortKey, Cohort]:
    """Group one-row-per-listing data into cohorts. Rows for variants the
    catalogue does not know are dropped (the ingest runner quarantines them
    upstream with a reason)."""
    out: dict[CohortKey, Cohort] = {}
    if latest.empty:
        return out
    known = latest[latest["variant_id"].isin(segment_of.keys())]
    for (variant_id, year), g in known.groupby(["variant_id", "model_year"], sort=True):
        km = g["km"].to_numpy(dtype=int)
        ref_km = int(round(float(np.median(km))))
        out[(str(variant_id), int(year))] = Cohort(
            variant_id=str(variant_id),
            model_year=int(year),
            segment=segment_of[str(variant_id)],
            ids=g["listing_id"].to_numpy(dtype=object),
            y=g["y"].to_numpy(dtype=float),
            km=km,
            dealer=g["dealer"].to_numpy(dtype=bool),
            ref_km=ref_km,
            x=centred_logkm(km, ref_km),
        )
    return out


def by_segment(cohorts: dict[CohortKey, Cohort]) -> dict[str, list[Cohort]]:
    groups: dict[str, list[Cohort]] = {}
    for c in cohorts.values():
        groups.setdefault(c.segment, []).append(c)
    return groups
