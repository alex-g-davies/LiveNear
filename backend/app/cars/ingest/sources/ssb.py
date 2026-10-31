"""Statistics Norway (SSB) PxWeb API (spec 022 R8). Open data (NLOD).

* CPI, table 03013 (Konsumprisindeks, 2015 = 100), monthly, all-item index.
* Household electricity price, table 09387 (Kraftpris, nettleie og avgifter
  for husholdninger), quarterly, øre/kWh incl. grid rent and taxes.

Both are POST queries returning JSON-stat 2; `parse_jsonstat_latest` takes
the last period of the single-series response.
"""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any

from ..fetch import fetch
from . import SourceContext, SourceOutput, stamp

SOURCE = "ssb"
CPI_URL = "https://data.ssb.no/api/v0/no/table/03013/"
ELECTRICITY_URL = "https://data.ssb.no/api/v0/no/table/09387/"
CPI_QUERY: dict[str, Any] = {
    "query": [
        {"code": "Konsumgrp", "selection": {"filter": "vs:CoiCop2016niva1", "values": ["TOTAL"]}},
        {"code": "ContentsCode", "selection": {"filter": "item", "values": ["KpiIndMnd"]}},
        {"code": "Tid", "selection": {"filter": "top", "values": ["1"]}},
    ],
    "response": {"format": "json-stat2"},
}
ELECTRICITY_QUERY: dict[str, Any] = {
    "query": [
        {
            "code": "ContentsCode",
            "selection": {"filter": "item", "values": ["KraftprisNettleieAvg"]},
        },
        {"code": "Tid", "selection": {"filter": "top", "values": ["1"]}},
    ],
    "response": {"format": "json-stat2"},
}
COLUMNS = ("series", "period", "value", "unit", "table", "source", "snapshot_sha256", "ingested_on")


def parse_jsonstat_latest(doc: dict[str, Any]) -> tuple[str, Decimal]:
    """(period label, value) of the last time period in a JSON-stat 2 dataset
    with a single value per period."""
    tid = doc["dimension"]["Tid"]["category"]["index"]
    periods = sorted(tid.items(), key=lambda kv: kv[1])
    values = doc["value"]
    size = doc.get("size") or []
    ids = doc.get("id") or []
    stride = 1
    if ids and size and "Tid" in ids:
        pos = ids.index("Tid")
        for s in size[pos + 1 :]:
            stride *= int(s)
    last_period, last_idx = periods[-1]
    value = values[last_idx * stride]
    if value is None:
        raise ValueError(f"SSB value missing for {last_period}")
    return str(last_period), Decimal(str(value))


def cpi_record(doc: dict[str, Any]) -> dict[str, Any]:
    period, value = parse_jsonstat_latest(doc)
    return {
        "series": "cpi_index",
        "period": period,
        "value": str(value),
        "unit": "index 2015=100",
        "table": "03013",
        "source": CPI_URL,
    }


def electricity_record(doc: dict[str, Any]) -> dict[str, Any]:
    period, value = parse_jsonstat_latest(doc)
    return {
        "series": "home_ore_per_kwh",
        "period": period,
        "value": str(value),
        "unit": "øre/kWh incl. grid rent and taxes",
        "table": "09387",
        "source": ELECTRICITY_URL,
    }


def run_source(ctx: SourceContext) -> SourceOutput:
    rows: list[dict[str, Any]] = []
    last_snap = None
    for url, query, make in (
        (CPI_URL, CPI_QUERY, cpi_record),
        (ELECTRICITY_URL, ELECTRICITY_QUERY, electricity_record),
    ):
        snap = fetch(
            url,
            SOURCE,
            ctx.raw_dir,
            method="POST",
            json_body=query,
            ext="json",
            client=ctx.http,
            r2_upload=ctx.r2_upload,
            r2_client=ctx.r2_client,
        )
        rec = make(json.loads(snap.read_text()))
        stamp([rec], snap, ctx.today)
        rows.append(rec)
        last_snap = snap
    return SourceOutput(SOURCE, rows_in=len(rows), stored=rows, snapshot=last_snap, columns=COLUMNS)
