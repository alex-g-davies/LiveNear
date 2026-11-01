"""Owner-collected listings CSV (spec 022 R8). Contract: docs/cars/sources.md.

parse -> normalise units -> map variant -> validate -> (enrich, e.g. Vegvesen)
-> reconcile (hash ids, drop reg numbers, dedupe) -> rows for the store.
"""

from __future__ import annotations

import csv
import io
from datetime import UTC, datetime, time
from typing import Any

from ...market.predict import anchor_value
from ..fetch import archive_bytes
from ..reconcile import map_variant, reconcile_listings
from ..store import LISTING_STORE_COLUMNS
from ..validate import LISTING_RULES, ValidationContext, normalise_listing, validate_rows
from . import SourceContext, SourceOutput, stamp

SOURCE = "listings_csv"


def parse_csv_text(text: str) -> list[dict[str, Any]]:
    return [dict(r) for r in csv.DictReader(io.StringIO(text))]


def prior_value_fn(ctx: SourceContext):
    priors = ctx.priors
    if priors is None:
        return None

    def prior_value(variant_id: str, model_year: int, km: int) -> int | None:
        if variant_id not in priors.variants:
            return None
        age_months = max(0, (ctx.today.year - model_year) * 12 + (ctx.today.month - 7))
        try:
            value, _, _ = anchor_value(priors, variant_id, model_year, age_months, km, dealer=False)
        except (KeyError, ValueError):
            return None
        return value

    return prior_value


def run_source(ctx: SourceContext) -> SourceOutput:
    if ctx.listings_path is None:
        return SourceOutput(SOURCE, status="disabled", note="no --listings path given")
    body = ctx.listings_path.read_bytes()
    snap = archive_bytes(
        body,
        source=SOURCE,
        raw_dir=ctx.raw_dir,
        url=ctx.listings_path.resolve().as_uri(),
        fetched_at=datetime.combine(ctx.today, time(0, 0), tzinfo=UTC),
        ext="csv",
        r2_upload=ctx.r2_upload,
        r2_client=ctx.r2_client,
    )
    raw_rows = parse_csv_text(body.decode("utf-8-sig"))
    rows = [normalise_listing(r) for r in raw_rows]
    for r in rows:
        vid = map_variant(r, ctx.vehicles)
        if vid:
            r["variant_id"] = vid
    vctx = ValidationContext(as_of=ctx.today, prior_value=prior_value_fn(ctx))
    ok, bad = validate_rows(rows, LISTING_RULES, vctx)
    for enrich in ctx.enrichers:
        ok = enrich(ok)
    stored, unknown = reconcile_listings(ok, ctx.vehicles)
    bad.extend(unknown)
    stamp(stored, snap, ctx.today)
    return SourceOutput(
        SOURCE,
        rows_in=len(raw_rows),
        stored=stored,
        quarantined=bad,
        snapshot=snap,
        consolidate_as="listings",
        columns=LISTING_STORE_COLUMNS,
    )
