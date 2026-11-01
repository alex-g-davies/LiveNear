"""Source adapters (spec 022 R8). Each module exposes `SOURCE` and
`run_source(ctx) -> SourceOutput`, raising `SourceDisabled` when it cannot
run here (missing key, pending terms check, web container).

There is deliberately no FINN adapter; no module here may name that site's
domain (a test greps for it).
"""

from __future__ import annotations

import importlib
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from types import ModuleType
from typing import Any

from ...bundle_schema import MarketModelParams, VariantRecord
from ..fetch import RawSnapshot
from ..validate import QuarantinedRow

SOURCE_NAMES = (
    "listings_csv",
    "new_prices_csv",
    "lease_csv",
    "norges_bank",
    "ssb",
    "vegvesen",
    "tesla_configurator",
)

Enricher = Callable[[list[dict[str, Any]]], list[dict[str, Any]]]


@dataclass
class SourceContext:
    today: date
    out_dir: Path
    raw_dir: Path
    vehicles: list[VariantRecord]
    priors: MarketModelParams | None = None
    env: dict[str, str] = field(default_factory=dict)
    listings_path: Path | None = None
    new_prices_path: Path | None = None
    lease_path: Path | None = None
    r2_upload: bool = False
    http: Any | None = None  # httpx.Client or None (a default client is created per fetch)
    r2_client: Any | None = None
    enrichers: list[Enricher] = field(
        default_factory=list
    )  # applied to listing rows before reconcile
    scratch: dict[str, Any] = field(
        default_factory=dict
    )  # cross-source notes (e.g. vegvesen lookups)

    @property
    def cache_dir(self) -> Path:
        return self.out_dir / "cache"

    def fetched_at(self) -> datetime:
        """Timestamp for raw archives: the run date (`today`, which `--today`
        may override) with the real clock time, so a replayed run files its
        snapshots under that day."""
        return datetime.combine(self.today, datetime.now(UTC).time(), tzinfo=UTC)


@dataclass
class SourceOutput:
    source: str
    rows_in: int = 0
    stored: list[dict[str, Any]] = field(default_factory=list)
    quarantined: list[QuarantinedRow] = field(default_factory=list)
    snapshot: RawSnapshot | None = None
    consolidate_as: str | None = None  # "listings" | "new_prices" | "lease_quotes"
    columns: tuple[str, ...] | None = None
    status: str = "ok"  # ok | disabled | failed
    note: str = ""


def load_source(name: str) -> ModuleType:
    if name not in SOURCE_NAMES:
        raise KeyError(f"unknown source {name!r}; known: {', '.join(SOURCE_NAMES)}")
    return importlib.import_module(f"{__name__}.{name}")


def stamp(
    rows: list[dict[str, Any]], snapshot: RawSnapshot | None, today: date
) -> list[dict[str, Any]]:
    sha = snapshot.sha256 if snapshot else ""
    for r in rows:
        r["snapshot_sha256"] = sha
        r["ingested_on"] = today.isoformat()
    return rows
