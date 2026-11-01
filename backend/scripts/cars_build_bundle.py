"""Build the cars data bundle from seeds plus (optionally) listings (spec 022 R7, R9).

    python scripts/cars_build_bundle.py                               # priors only
    python scripts/cars_build_bundle.py --listings private/listings.csv
    python scripts/cars_build_bundle.py --synthetic --out /tmp/bundle \
        --report docs/cars/backtest.md                                # fixture run

WARNING: the default --out is the COMMITTED bundle directory
backend/data/cars/. Running without --out rewrites meta.json, vehicles.json,
cohorts.json, market_model.json, new_prices.json, lease_offers.json and
rates.json there. Use --out <dir> to build elsewhere.

--listings may be the owner's CSV (contract in docs/cars/sources.md) or the
ingest store's consolidated store/listings.csv (hashed, øre). --synthetic
uses the committed synthetic fixture (data/cars/fixtures/listings_fixture.csv)
and --write-fixture regenerates that fixture from app.cars.market.synthetic.
"""

from __future__ import annotations

import argparse
import csv
import sys
from datetime import date
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.cars.data_bundle import FIXTURE_LISTINGS, parse_listings_csv  # noqa: E402
from app.cars.market import seeds, synthetic  # noqa: E402
from app.cars.market.backtest import run_backtest  # noqa: E402
from app.cars.market.bundle import BUNDLE_DIR, build_bundle  # noqa: E402
from app.cars.market.report import render_backtest_markdown  # noqa: E402
from app.cars.market.schema import rows_from_dicts  # noqa: E402


def load_listings(path: Path, vehicles):
    text = path.read_text(encoding="utf-8-sig")
    header = next(csv.reader(text.splitlines()[:1]), [])
    if "listing_id" in header and "ask_ore" in header:  # ingest store format
        return rows_from_dicts(csv.DictReader(text.splitlines()))
    return parse_listings_csv(text, vehicles)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--listings", type=Path, help="listings CSV (owner contract or ingest store)")
    p.add_argument("--synthetic", action="store_true", help="use the committed synthetic fixture")
    p.add_argument("--write-fixture", action="store_true", help=f"regenerate {FIXTURE_LISTINGS}")
    p.add_argument("--out", type=Path, default=BUNDLE_DIR, help="bundle dir (default: committed!)")
    p.add_argument("--as-of", type=date.fromisoformat, help="fit date (default: latest snapshot)")
    p.add_argument("--report", type=Path, help="write the backtest Markdown here")
    a = p.parse_args(argv)

    vehicles = seeds.load_vehicles()
    new_prices = seeds.load_new_prices()
    priors = seeds.load_retention_priors(vehicles, new_prices)

    if a.write_fixture:
        rows, truth = synthetic.generate(vehicles, new_prices, priors)
        FIXTURE_LISTINGS.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE_LISTINGS.write_text(synthetic.to_csv(rows), encoding="utf-8")
        print(
            f"fixture written: {FIXTURE_LISTINGS} ({len(rows)} rows, {truth.n_listings} listings)"
        )

    listings = None
    label = "seed priors only"
    if a.listings:
        listings = load_listings(a.listings, vehicles)
        label = f"owner listings CSV ({a.listings.name})"
    elif a.synthetic:
        listings = parse_listings_csv(FIXTURE_LISTINGS.read_text(encoding="utf-8"), vehicles)
        label = "the synthetic fixture data/cars/fixtures/listings_fixture.csv"

    as_of = a.as_of
    if listings and as_of is None:
        as_of = max(x.snapshot_date for x in listings)

    params = None
    if listings:
        report, fit = run_backtest(listings, vehicles, new_prices, priors, as_of)
        params = fit.params
        print(
            f"fit {params.version}: status={params.status}, listings={report.n_listings}, "
            f"cohorts={report.n_cohorts}, coverage={100 * report.overall.coverage:.1f} % "
            f"(Wilson {100 * report.overall.wilson_low:.1f}-"
            f"{100 * report.overall.wilson_high:.1f}), "
            f"gate={'PASS' if report.passes else 'FAIL'}"
        )
        if a.report:
            a.report.parent.mkdir(parents=True, exist_ok=True)
            a.report.write_text(render_backtest_markdown(report, params, label), encoding="utf-8")
            print(f"backtest report written: {a.report}")
        if not report.passes:
            print("BACKTEST GATE FAILED: bundle not written", file=sys.stderr)
            return 1

    meta = build_bundle(out_dir=a.out, params=params, as_of=as_of if listings else None)
    print(f"bundle written to {a.out} (as of {meta.bundle_as_of})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
