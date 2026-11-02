"""Re-shape the owner's private exports into the module's CSV contracts.

    python scripts/cars_convert_owner_export.py \
        --listings data/cars/private/owner_exports/<used-listings>.csv [more.csv ...] \
        --lease    data/cars/private/owner_exports/<lease-offers>.csv \
        --new-cars data/cars/private/owner_exports/<new-stock>.csv \
        --out      data/cars/private/contract

Writes listings.csv, lease_quotes.csv and new_prices.csv under --out (a
gitignored folder) and prints what was kept and why rows were skipped.
Then: `python -m app.cars.ingest.runner --listings <out>/listings.csv ...`
and `python scripts/cars_build_bundle.py --listings <store>/listings.csv`.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.cars.ingest import owner_export as oe  # noqa: E402
from app.cars.market import seeds  # noqa: E402


def _report(name: str, conv: oe.Conversion) -> None:
    print(f"{name}: kept {conv.n}")
    for reason, n in conv.skipped.most_common():
        print(f"  skipped {n:5d}  {reason}")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--listings", type=Path, nargs="+")
    p.add_argument("--lease", type=Path)
    p.add_argument("--new-cars", type=Path)
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args(argv)
    vehicles = seeds.load_vehicles()
    a.out.mkdir(parents=True, exist_ok=True)

    if a.listings:
        rows = [r for f in a.listings for r in oe.read_csv_text(f.read_text("utf-8-sig"))]
        conv = oe.convert_listings(rows, vehicles)
        (a.out / "listings.csv").write_text(
            oe.write_csv(conv.rows, oe.LISTING_OUT_COLUMNS), encoding="utf-8"
        )
        _report("listings", conv)
    if a.lease:
        conv = oe.convert_lease_offers(oe.read_csv_text(a.lease.read_text("utf-8-sig")), vehicles)
        (a.out / "lease_quotes.csv").write_text(
            oe.write_csv(conv.rows, oe.LEASE_OUT_COLUMNS), encoding="utf-8"
        )
        _report("lease offers", conv)
        for r in conv.rows:
            print(
                f"  {r['offer_id']}: {r['variant_id']} {r['model_year']} {r['condition']} "
                f"{r['monthly_nok']} kr/mo x {r['term_months']}, {r['km_per_year_cap']} km/yr, "
                f"upfront {r['upfront_nok']}"
            )
    if a.new_cars:
        rows = oe.read_csv_text(a.new_cars.read_text("utf-8-sig"))
        conv = oe.convert_new_stock(rows, vehicles)
        (a.out / "new_prices.csv").write_text(
            oe.write_csv(conv.rows, oe.NEW_PRICE_OUT_COLUMNS), encoding="utf-8"
        )
        _report("new stock", conv)
        summary = oe.near_new_summary(rows)
        if summary:
            print("  near-new asking prices for catalogue variants (upper bound on list price):")
            for vid, year, n, lo, hi in summary:
                print(f"    {vid} {year}: n={n}, {lo}-{hi} kr")
    return 0


if __name__ == "__main__":
    sys.exit(main())
