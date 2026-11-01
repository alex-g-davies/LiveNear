"""Versioned CSV store (spec 022 R8). No parquet, no database.

    <out>/store/<source>/<YYYY-MM-DD>.csv   rows stored by one run of one source
    <out>/store/listings.csv                 all listing snapshots, consolidated
    <out>/store/new_prices.csv
    <out>/store/lease_quotes.csv
    <out>/quarantine/<source>-<date>.csv     rows that failed validation
    <out>/quarantine/spot_check.csv          2 % seeded sample of stored rows
    <out>/run_report.json

Every stored row carries `snapshot_sha256` (its raw snapshot) and
`ingested_on`. Consolidated files are merged on a key: for listings
(listing_id, snapshot_date); the latest run wins.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Iterable
from datetime import date
from pathlib import Path
from typing import Any

from .validate import QuarantinedRow

LISTING_STORE_COLUMNS = (
    "listing_id",
    "variant_id",
    "snapshot_date",
    "model_year",
    "first_reg_month",
    "km",
    "ask_ore",
    "seller_type",
    "status",
    "location",
    "ex_fleet_or_taxi",
    "warranty_note",
    "heat_pump",
    "battery_kwh",
    "drive",
    "power_kw",
    "make",
    "model",
    "trim_as_listed",
    "snapshot_sha256",
    "ingested_on",
)
CONSOLIDATED_KEYS: dict[str, tuple[str, ...]] = {
    "listings": ("listing_id", "snapshot_date"),
    "new_prices": ("variant_id", "model_year", "valid_from"),
    "lease_quotes": ("offer_id",),
}
FORBIDDEN_COLUMNS = ("reg_number", "vin")


def rows_to_csv(rows: Iterable[dict[str, Any]], columns: Iterable[str] | None = None) -> str:
    rows = list(rows)
    cols = list(columns) if columns else sorted({k for r in rows for k in r.keys()})
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore", lineterminator="\n")
    w.writeheader()
    for r in rows:
        w.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in cols})
    return buf.getvalue()


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


class Store:
    def __init__(self, out_dir: Path):
        self.out_dir = Path(out_dir)
        self.store_dir = self.out_dir / "store"
        self.quarantine_dir = self.out_dir / "quarantine"
        self.store_dir.mkdir(parents=True, exist_ok=True)
        self.quarantine_dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _check_columns(rows: list[dict[str, Any]]) -> None:
        for r in rows:
            for k in FORBIDDEN_COLUMNS:
                if k in r:
                    raise ValueError(f"refusing to store clear-text identifier column {k!r}")

    def write_source(
        self,
        source: str,
        day: date,
        rows: list[dict[str, Any]],
        columns: Iterable[str] | None = None,
    ) -> Path:
        self._check_columns(rows)
        folder = self.store_dir / source
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{day.isoformat()}.csv"
        path.write_text(rows_to_csv(rows, columns), encoding="utf-8")
        return path

    def consolidate(
        self, name: str, rows: list[dict[str, Any]], columns: Iterable[str] | None = None
    ) -> Path:
        """Merge `rows` into `<store>/<name>.csv` on the file's key."""
        self._check_columns(rows)
        key = CONSOLIDATED_KEYS[name]
        path = self.store_dir / f"{name}.csv"
        merged: dict[tuple[str, ...], dict[str, Any]] = {}
        for r in read_csv(path) + rows:
            merged[tuple(str(r.get(k, "")) for k in key)] = r
        out = sorted(merged.values(), key=lambda r: tuple(str(r.get(k, "")) for k in key))
        cols = list(columns) if columns else None
        if cols is None:
            cols = sorted({k for r in out for k in r.keys()})
        path.write_text(rows_to_csv(out, cols), encoding="utf-8")
        return path

    def quarantine(self, source: str, day: date, rows: list[QuarantinedRow]) -> Path | None:
        if not rows:
            return None
        path = self.quarantine_dir / f"{source}-{day.isoformat()}.csv"
        recs = [
            {
                **{k: v for k, v in q.row.items() if k not in FORBIDDEN_COLUMNS},
                "failed_checks": "|".join(q.failed_checks),
                "raw_excerpt": q.raw_excerpt,
            }
            for q in rows
        ]
        cols = sorted({k for r in recs for k in r.keys()} - {"failed_checks", "raw_excerpt"})
        path.write_text(
            rows_to_csv(recs, [*cols, "failed_checks", "raw_excerpt"]), encoding="utf-8"
        )
        return path

    def spot_check(self, rows: list[dict[str, Any]]) -> Path:
        path = self.quarantine_dir / "spot_check.csv"
        path.write_text(rows_to_csv(rows), encoding="utf-8")
        return path
