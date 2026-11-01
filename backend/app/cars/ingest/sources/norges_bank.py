"""Norges Bank policy rate (spec 022 R8). Open data, attribution.

    https://data.norges-bank.no/api/data/IR/B.KPRA.SD.R?format=sdmx-json&lastNObservations=1

Car-loan heuristic (status estimate, documented in docs/cars/sources.md):
    car_loan_rate_pct = policy_rate_pct + CAR_LOAN_SPREAD_PP   (P10-P90 +/- 1.5 pp)
The spread is a placeholder for the typical gap between the policy rate and
Norwegian banks' nominal car-loan rates; the owner's quoted bank rate
replaces it in the scenario.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from ...engine.models import In, Range
from ..fetch import RawSnapshot, fetch
from . import SourceContext, SourceOutput, stamp

SOURCE = "norges_bank"
URL = "https://data.norges-bank.no/api/data/IR/B.KPRA.SD.R?format=sdmx-json&lastNObservations=1"
CAR_LOAN_SPREAD_PP = Decimal("2.5")
CAR_LOAN_BAND_PP = Decimal("1.5")
COLUMNS = (
    "as_of",
    "policy_rate_pct",
    "car_loan_rate_pct",
    "car_loan_low_pct",
    "car_loan_high_pct",
    "spread_pp",
    "status",
    "basis",
    "source",
    "snapshot_sha256",
    "ingested_on",
)


def parse_policy_rate(doc: dict[str, Any]) -> tuple[date, Decimal]:
    """(observation date, policy rate in percent) from an SDMX-JSON document."""
    data = doc.get("data", doc)
    datasets = data["dataSets"]
    series = datasets[0]["series"]
    first = next(iter(series.values()))
    obs = first["observations"]
    last_idx = max(obs.keys(), key=lambda k: int(k))
    value = Decimal(str(obs[last_idx][0]))
    dims = data["structure"]["dimensions"]["observation"]
    time_dim = next(d for d in dims if d.get("id") in {"TIME_PERIOD", "Tid", "TIME"})
    period = str(time_dim["values"][int(last_idx)]["id"])
    return _parse_period(period), value


def _parse_period(period: str) -> date:
    if len(period) == 10:
        return date.fromisoformat(period)
    if len(period) == 7:  # YYYY-MM
        return date.fromisoformat(period + "-01")
    return date(int(period[:4]), 1, 1)


def to_rates_patch(obs_date: date, policy_pct: Decimal) -> dict[str, In[Decimal]]:
    """Fields of `bundle_schema.RatesRecord` this source can fill."""
    loan = policy_pct + CAR_LOAN_SPREAD_PP
    return {
        "policy_rate_pct": In[Decimal](
            id="rates.policy_rate_pct",
            value=policy_pct,
            source=f"Norges Bank policy rate (KPRA), {URL}",
            as_of=obs_date,
            status="live",
        ),
        "car_loan_rate_pct": In[Decimal](
            id="rates.car_loan_rate_pct",
            value=loan,
            source="Policy rate + placeholder spread",
            as_of=obs_date,
            status="estimate",
            basis=(
                f"Heuristic: policy rate + {CAR_LOAN_SPREAD_PP} pp spread; the owner's quoted bank "
                "rate replaces it"
            ),
            range=Range(low=loan - CAR_LOAN_BAND_PP, high=loan + CAR_LOAN_BAND_PP),
        ),
    }


def record_from_snapshot(snap: RawSnapshot) -> dict[str, Any]:
    import json

    obs_date, policy = parse_policy_rate(json.loads(snap.read_text()))
    patch = to_rates_patch(obs_date, policy)
    loan = patch["car_loan_rate_pct"]
    return {
        "as_of": obs_date.isoformat(),
        "policy_rate_pct": str(policy),
        "car_loan_rate_pct": str(loan.value),
        "car_loan_low_pct": str(loan.range.low) if loan.range else "",
        "car_loan_high_pct": str(loan.range.high) if loan.range else "",
        "spread_pp": str(CAR_LOAN_SPREAD_PP),
        "status": loan.status,
        "basis": loan.basis or "",
        "source": URL,
    }


def run_source(ctx: SourceContext) -> SourceOutput:
    snap = fetch(
        URL,
        SOURCE,
        ctx.raw_dir,
        ext="json",
        client=ctx.http,
        r2_upload=ctx.r2_upload,
        r2_client=ctx.r2_client,
        now=ctx.fetched_at(),
    )
    rows = [record_from_snapshot(snap)]
    stamp(rows, snap, ctx.today)
    return SourceOutput(SOURCE, rows_in=1, stored=rows, snapshot=snap, columns=COLUMNS)
