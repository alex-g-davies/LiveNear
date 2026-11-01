"""Owner-maintained new-price history CSV (spec 022 R8).

Contract: make, model, trim_group, model_year, list_price_nok_incl_vat,
valid_from, source_url. Stored with price in øre and the catalogue variant.
"""

from __future__ import annotations

from datetime import UTC, datetime, time
from typing import Any

from ..fetch import archive_bytes
from ..reconcile import map_variant
from ..validate import (
    NEW_PRICE_RULES,
    QuarantinedRow,
    ValidationContext,
    parse_nok_to_ore,
    validate_rows,
)
from . import SourceContext, SourceOutput, stamp
from .listings_csv import parse_csv_text

SOURCE = "new_prices_csv"
COLUMNS = (
    "variant_id",
    "make",
    "model",
    "trim_group",
    "model_year",
    "price_ore",
    "valid_from",
    "source_url",
    "status",
    "basis",
    "snapshot_sha256",
    "ingested_on",
)


def to_record(row: dict[str, Any], variant_id: str) -> dict[str, Any]:
    return {
        "variant_id": variant_id,
        "make": row.get("make", ""),
        "model": row.get("model", ""),
        "trim_group": row.get("trim_group", ""),
        "model_year": int(str(row["model_year"])),
        "price_ore": parse_nok_to_ore(row["list_price_nok_incl_vat"]),
        "valid_from": str(row["valid_from"]).strip(),
        "source_url": row.get("source_url", ""),
        "status": (row.get("status") or "live").strip().lower(),
        "basis": row.get("basis", ""),
    }


def run_source(ctx: SourceContext) -> SourceOutput:
    if ctx.new_prices_path is None:
        return SourceOutput(SOURCE, status="disabled", note="no --new-prices path given")
    body = ctx.new_prices_path.read_bytes()
    snap = archive_bytes(
        body,
        source=SOURCE,
        raw_dir=ctx.raw_dir,
        url=ctx.new_prices_path.resolve().as_uri(),
        fetched_at=datetime.combine(ctx.today, time(0, 0), tzinfo=UTC),
        ext="csv",
        r2_upload=ctx.r2_upload,
        r2_client=ctx.r2_client,
    )
    raw_rows = parse_csv_text(body.decode("utf-8-sig"))
    ok, bad = validate_rows(raw_rows, NEW_PRICE_RULES, ValidationContext(as_of=ctx.today))
    stored: list[dict[str, Any]] = []
    for r in ok:
        vid = map_variant(r, ctx.vehicles)
        if vid is None:
            bad.append(QuarantinedRow(r, ["reconcile:unknown_variant"]))
            continue
        stored.append(to_record(r, vid))
    stamp(stored, snap, ctx.today)
    return SourceOutput(
        SOURCE,
        rows_in=len(raw_rows),
        stored=stored,
        quarantined=bad,
        snapshot=snap,
        consolidate_as="new_prices",
        columns=COLUMNS,
    )
