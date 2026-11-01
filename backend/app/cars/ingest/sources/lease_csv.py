"""Manual lease quotes CSV (spec 022 R8).

Contract: make, model, trim, term_months, km_per_year_cap, monthly_nok,
upfront_nok, fees_nok, excess_km_fee_nok, early_exit_terms, includes,
source, date. `offer_id` is taken from the file when present, else derived
from (source, date, make, model, trim, term, cap).
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, time
from typing import Any

from ..fetch import archive_bytes
from ..reconcile import map_variant
from ..validate import (
    LEASE_RULES,
    QuarantinedRow,
    ValidationContext,
    parse_nok_to_ore,
    validate_rows,
)
from . import SourceContext, SourceOutput, stamp
from .listings_csv import parse_csv_text

SOURCE = "lease_csv"
COLUMNS = (
    "offer_id",
    "variant_id",
    "model_year",
    "term_months",
    "km_per_year_cap",
    "monthly_ore",
    "upfront_ore",
    "fees_ore",
    "excess_km_fee_ore",
    "early_exit_terms",
    "includes",
    "end_of_lease_fee_ore",
    "delivery_months",
    "source",
    "date",
    "status",
    "basis",
    "snapshot_sha256",
    "ingested_on",
)


def offer_id_for(row: dict[str, Any]) -> str:
    given = str(row.get("offer_id") or "").strip()
    if given:
        return given
    key = "|".join(
        str(row.get(k, "")).strip().lower()
        for k in ("source", "date", "make", "model", "trim", "term_months", "km_per_year_cap")
    )
    return "lq-" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:12]


def to_record(row: dict[str, Any], variant_id: str, today_year: int) -> dict[str, Any]:
    def ore(col: str) -> int:
        return parse_nok_to_ore(row.get(col)) or 0

    return {
        "offer_id": offer_id_for(row),
        "variant_id": variant_id,
        "model_year": int(str(row.get("model_year") or today_year)),
        "term_months": int(float(row["term_months"])),
        "km_per_year_cap": int(float(row["km_per_year_cap"])),
        "monthly_ore": ore("monthly_nok"),
        "upfront_ore": ore("upfront_nok"),
        "fees_ore": ore("fees_nok"),
        "excess_km_fee_ore": ore("excess_km_fee_nok"),
        "early_exit_terms": (row.get("early_exit_terms") or "default").strip(),
        "includes": (row.get("includes") or "").strip(),
        "end_of_lease_fee_ore": ore("end_of_lease_fee_nok"),
        "delivery_months": int(float(row.get("delivery_months") or 0)),
        "source": row.get("source", ""),
        "date": str(row.get("date", "")).strip(),
        "status": (row.get("status") or "live").strip().lower(),
        "basis": row.get("basis", ""),
    }


def run_source(ctx: SourceContext) -> SourceOutput:
    if ctx.lease_path is None:
        return SourceOutput(SOURCE, status="disabled", note="no --lease path given")
    body = ctx.lease_path.read_bytes()
    snap = archive_bytes(
        body,
        source=SOURCE,
        raw_dir=ctx.raw_dir,
        url=ctx.lease_path.resolve().as_uri(),
        fetched_at=datetime.combine(ctx.today, time(0, 0), tzinfo=UTC),
        ext="csv",
        r2_upload=ctx.r2_upload,
        r2_client=ctx.r2_client,
    )
    raw_rows = parse_csv_text(body.decode("utf-8-sig"))
    ok, bad = validate_rows(raw_rows, LEASE_RULES, ValidationContext(as_of=ctx.today))
    stored: list[dict[str, Any]] = []
    for r in ok:
        vid = map_variant(r, ctx.vehicles)
        if vid is None:
            bad.append(QuarantinedRow(r, ["reconcile:unknown_variant"]))
            continue
        stored.append(to_record(r, vid, ctx.today.year))
    stamp(stored, snap, ctx.today)
    return SourceOutput(
        SOURCE,
        rows_in=len(raw_rows),
        stored=stored,
        quarantined=bad,
        snapshot=snap,
        consolidate_as="lease_quotes",
        columns=COLUMNS,
    )
