"""CLI: run a scenario YAML and print ranked options (spec 022 R3 acceptance).

python -m app.cars.engine.cli scenarios/owner.yaml [--measure per_month] [--exit 36]
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from ..scenario_io import load_scenario
from .measures import MEASURES
from .money import to_nok_str
from .run import run_scenario

MEASURE_LABELS = {
    "per_month": "Net cost per month",
    "tco": "Total cost of ownership",
    "npc": "Net present cost",
    "cash_up_front": "Cash up front",
    "per_km": "Cost per km",
}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Norway car TCO: run a scenario")
    ap.add_argument("scenario", type=Path)
    ap.add_argument("--measure", choices=MEASURES, default="per_month")
    ap.add_argument("--exit", type=int, default=36, help="exit month for the line-item breakdown")
    args = ap.parse_args(argv)

    sc = load_scenario(args.scenario)
    t0 = time.perf_counter()
    res = run_scenario(sc, args.measure)
    elapsed = time.perf_counter() - t0

    print(f"{MEASURE_LABELS[args.measure]}, weighted by exit odds {res.exit_odds}")
    print(f"{len(res.options)} options, {res.draws} draws, seed {res.seed}, {elapsed:.2f}s\n")
    print(f"{'#':>2}  {'Option':44} {'Expected':>16} {'Best':>16} {'Worst':>16}  Status")
    for i, o in enumerate(res.options, 1):
        m = o.measures[args.measure]
        print(
            f"{i:>2}  {o.label[:44]:44} {to_nok_str(m.expected.p50):>16} "
            f"{to_nok_str(m.best.value):>16} {to_nok_str(m.worst.value):>16}  {o.status}"
        )
    if res.ruled_out:
        print("\nRuled out by your limits:")
        for r in res.ruled_out:
            print(f"  - {r.label}: {', '.join(r.reasons)}")
    if res.sensitivity:
        print(f"\nWhat moves the top result ({res.sensitivity_option_id}):")
        for s in res.sensitivity:
            print(f"  {s.label:18} {to_nok_str(s.low):>16} .. {to_nok_str(s.high):>16}")
    for o in res.options:
        print(f"\n{o.label} — where the money goes at month {args.exit}:")
        items = o.display.get(args.exit)
        if items is None:
            print("  (choose an exit month of 12, 24, 36 or 48)")
            continue
        for d in items:
            print(f"  {d.label:22} {to_nok_str(d.ore):>16}")
        print(f"  {'Total (TCO)':22} {to_nok_str(o.measures['tco'].deterministic[args.exit]):>16}")
        if o.material_estimates:
            print(f"  Estimate because of: {', '.join(o.material_estimates)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
