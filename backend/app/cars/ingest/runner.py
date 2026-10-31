"""Ingestion runner (spec 022 R8).

    python -m app.cars.ingest.runner \
        --sources listings_csv,new_prices_csv,lease_csv,norges_bank,ssb,vegvesen,\
tesla_configurator --listings path.csv --out data_dir --raw-dir path [--r2]

Per source: fetch -> parse -> validate -> reconcile -> store. A `RunReport`
(rows in, stored, quarantined, health per source) is printed as a table and
written to `<out>/run_report.json`. The run FAILS (exit 1, loud log) when an
enabled source yields zero rows or when any field's empty-rate rises by more
than 20 percentage points against the previous `run_report.json`. A seeded
2 % sample of stored rows is written to `quarantine/spot_check.csv`.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import sys
from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from ..bundle_schema import MarketModelParams, VariantRecord
from ..market import seeds
from . import SourceDisabled
from .sources import SOURCE_NAMES, SourceContext, SourceOutput, load_source
from .store import Store
from .validate import empty_rates

log = logging.getLogger("cars.ingest")
EMPTY_RATE_JUMP = 0.20
SPOT_CHECK_SHARE = 0.02
SPOT_CHECK_SEED = 22


@dataclass
class SourceReport:
    source: str
    rows_in: int = 0
    stored: int = 0
    quarantined: int = 0
    status: str = "ok"  # ok | disabled | failed
    note: str = ""
    empty_rates: dict[str, float] = field(default_factory=dict)
    snapshot_sha256: str = ""
    store_path: str = ""


@dataclass
class RunReport:
    run_at: str
    today: str
    sources: list[SourceReport] = field(default_factory=list)
    failures: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.failures

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_at": self.run_at,
            "today": self.today,
            "ok": self.ok,
            "failures": list(self.failures),
            "sources": [asdict(s) for s in self.sources],
        }

    def table(self) -> str:
        head = f"{'source':<20} {'in':>6} {'stored':>7} {'quar.':>6}  {'status':<9} note"
        lines = [head, "-" * len(head)]
        for s in self.sources:
            lines.append(
                f"{s.source:<20} {s.rows_in:>6} {s.stored:>7} {s.quarantined:>6}  "
                f"{s.status:<9} {s.note}"
            )
        lines.append("")
        lines.append("RUN OK" if self.ok else "RUN FAILED: " + "; ".join(self.failures))
        return "\n".join(lines)


@dataclass
class RunConfig:
    sources: list[str]
    out_dir: Path
    raw_dir: Path
    listings_path: Path | None = None
    new_prices_path: Path | None = None
    lease_path: Path | None = None
    r2: bool = False
    today: date | None = None
    env: dict[str, str] | None = None
    http: Any | None = None
    r2_client: Any | None = None
    vehicles: list[VariantRecord] | None = None
    priors: MarketModelParams | None = None


def previous_report(out_dir: Path) -> RunReport | None:
    path = out_dir / "run_report.json"
    if not path.exists():
        return None
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
        return RunReport(
            run_at=d["run_at"],
            today=d["today"],
            sources=[SourceReport(**s) for s in d["sources"]],
            failures=list(d.get("failures", [])),
        )
    except (ValueError, KeyError, TypeError):
        return None


def empty_rate_jumps(current: SourceReport, previous: SourceReport | None) -> list[str]:
    if previous is None or previous.stored == 0 or current.stored == 0:
        return []
    out = []
    for k, rate in current.empty_rates.items():
        prev = previous.empty_rates.get(k)
        if prev is not None and rate - prev > EMPTY_RATE_JUMP:
            out.append(
                f"{current.source}: empty-rate of {k} jumped {100 * prev:.0f}% -> {100 * rate:.0f}%"
            )
    return out


def spot_sample(
    rows: list[dict[str, Any]], share: float = SPOT_CHECK_SHARE, seed: int = SPOT_CHECK_SEED
) -> list[dict[str, Any]]:
    if not rows:
        return []
    k = max(1, int(round(len(rows) * share)))
    rng = random.Random(seed)
    return [rows[i] for i in sorted(rng.sample(range(len(rows)), k))]


def _run_one(
    name: str, ctx: SourceContext, store: Store
) -> tuple[SourceReport, list[dict[str, Any]]]:
    rep = SourceReport(source=name)
    try:
        out: SourceOutput = load_source(name).run_source(ctx)
    except SourceDisabled as exc:
        rep.status, rep.note = "disabled", str(exc)
        log.warning("%s disabled: %s", name, exc)
        return rep, []
    except Exception as exc:  # noqa: BLE001 - one source must not hide the others
        rep.status, rep.note = "failed", f"{type(exc).__name__}: {exc}"
        log.error("%s failed: %s", name, rep.note)
        return rep, []
    rep.rows_in, rep.stored, rep.quarantined = out.rows_in, len(out.stored), len(out.quarantined)
    rep.status, rep.note = out.status, out.note
    rep.snapshot_sha256 = out.snapshot.sha256 if out.snapshot else ""
    if out.status == "disabled":
        return rep, []
    rep.empty_rates = empty_rates(out.stored, list(out.columns) if out.columns else None)
    if out.stored:
        rep.store_path = str(store.write_source(name, ctx.today, out.stored, out.columns))
        if out.consolidate_as:
            store.consolidate(out.consolidate_as, out.stored, out.columns)
    store.quarantine(name, ctx.today, out.quarantined)
    return rep, [{"source": name, **r} for r in out.stored]


def run(cfg: RunConfig) -> RunReport:
    env = dict(cfg.env if cfg.env is not None else os.environ)
    today = cfg.today or datetime.now(UTC).date()
    vehicles = cfg.vehicles or seeds.load_vehicles()
    priors = cfg.priors
    if priors is None:
        priors = seeds.load_retention_priors(vehicles, seeds.load_new_prices())
    out_dir = Path(cfg.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    store = Store(out_dir)
    prev = previous_report(out_dir)
    ctx = SourceContext(
        today=today,
        out_dir=out_dir,
        raw_dir=Path(cfg.raw_dir),
        vehicles=vehicles,
        priors=priors,
        env=env,
        listings_path=cfg.listings_path,
        new_prices_path=cfg.new_prices_path,
        lease_path=cfg.lease_path,
        r2_upload=cfg.r2,
        http=cfg.http,
        r2_client=cfg.r2_client,
    )
    report = RunReport(
        run_at=datetime.now(UTC).isoformat(timespec="seconds"), today=today.isoformat()
    )
    names = [s.strip() for s in cfg.sources if s.strip()]
    unknown = [n for n in names if n not in SOURCE_NAMES]
    if unknown:
        report.failures.append(f"unknown source(s): {', '.join(unknown)}")
        return report

    # Vegvesen enriches listing rows (needs clear-text reg numbers), so it is
    # wired in before the listings source runs and reported after it.
    if "vegvesen" in names:
        try:
            from .sources import vegvesen

            ctx.enrichers.append(vegvesen.make_enricher(ctx))
        except SourceDisabled as exc:
            log.warning("vegvesen disabled: %s", exc)

    all_stored: list[dict[str, Any]] = []
    for name in names:
        rep, stored = _run_one(name, ctx, store)
        report.sources.append(rep)
        all_stored.extend(stored)
        if rep.status == "failed":
            report.failures.append(f"{name}: {rep.note}")
        elif rep.status == "ok" and rep.stored == 0 and name != "vegvesen":
            report.failures.append(f"{name}: zero rows stored for an enabled source")
        prev_rep = next((s for s in prev.sources if s.source == name), None) if prev else None
        report.failures.extend(empty_rate_jumps(rep, prev_rep))

    store.spot_check(spot_sample(all_stored))
    (out_dir / "run_report.json").write_text(
        json.dumps(report.to_dict(), indent=1), encoding="utf-8"
    )
    if report.failures:
        for f in report.failures:
            log.error("HEALTH CHECK FAILED: %s", f)
    return report


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="python -m app.cars.ingest.runner", description=__doc__.split("\n\n")[1]
    )
    p.add_argument(
        "--sources", default="listings_csv", help=f"comma list of: {', '.join(SOURCE_NAMES)}"
    )
    p.add_argument(
        "--listings", type=Path, help="owner listings CSV (contract in docs/cars/sources.md)"
    )
    p.add_argument("--new-prices", type=Path, help="owner new-price history CSV")
    p.add_argument("--lease", type=Path, help="owner lease quotes CSV")
    p.add_argument(
        "--out", type=Path, required=True, help="data dir for store/, quarantine/, run_report.json"
    )
    p.add_argument(
        "--raw-dir", type=Path, required=True, help="local raw snapshot folder (gitignored)"
    )
    p.add_argument(
        "--r2", action="store_true", help="also upload raw snapshots to R2 (CARS_R2_* env)"
    )
    p.add_argument("--today", type=date.fromisoformat, help="override the run date (YYYY-MM-DD)")
    a = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    report = run(
        RunConfig(
            sources=a.sources.split(","),
            out_dir=a.out,
            raw_dir=a.raw_dir,
            listings_path=a.listings,
            new_prices_path=a.new_prices,
            lease_path=a.lease,
            r2=a.r2,
            today=a.today,
        )
    )
    print(report.table())
    return 0 if report.ok else 1


if __name__ == "__main__":
    sys.exit(main())
