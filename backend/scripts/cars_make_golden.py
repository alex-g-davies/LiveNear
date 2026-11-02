"""Regenerate the golden-case YAML inputs under scenarios/golden/ (spec 022 R12).

The *expected* numbers in each file are hand-worked in docs/cars/golden/*.md
and typed here by a human; this script only writes the inputs next to them
so the YAML stays in sync with tests/cars/builders.py. Run from backend/:

    python scripts/cars_make_golden.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tests.cars import builders as b  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "scenarios" / "golden"


def write(name: str, inputs: dict, expected: dict, worked_in: str) -> None:
    inputs = dict(inputs)
    # Golden inputs reference the test fixtures by a path relative to backend/.
    inputs["market"]["tax_rules"] = str(
        Path(inputs["market"]["tax_rules"]).relative_to(OUT.parents[1]).as_posix()
    )
    doc = {"name": name, "worked_in": worked_in, "inputs": inputs, "expected": expected}
    (OUT / f"{name}.yaml").write_text(
        yaml.safe_dump(doc, sort_keys=False, allow_unicode=True, width=100), encoding="utf-8"
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    # G1: used 1–3 yr, cash, r = 0 ------------------------------------------------
    g1 = b.scenario([b.used_cash()])
    write(
        "g1_used_cash",
        g1,
        {
            "option": "used-cash",
            "cash_up_front_ore": 21_500_000,
            "tco_ore": {12: 6_325_000, 36: 13_425_000},
            "npc_ore": {12: 6_325_000, 36: 13_425_000},
            "per_month_ore": {12: 527_083, 36: 372_917},
            "per_km_ore": {12: 527, 36: 373},
            "expected_tco_ore": 9_875_000,
            "display_36_ore": {
                "value_lost": 6_149_000,
                "financing": 0,
                "insurance": 3_600_000,
                "fees_and_taxes": 1_596_000,
                "energy": 720_000,
                "tyres": 1_000_000,
                "service": 360_000,
                "opportunity_cost": 0,
            },
        },
        "docs/cars/golden/g1_used_cash.md",
    )

    # G2: new, loan = the textbook 100 000 at 12 % over 12 months ------------------
    g2 = b.scenario(
        [
            {
                "id": "new-loan",
                "label": "new-loan",
                "vehicle": b.vehicle(),
                "deal": {
                    "mode": "new",
                    "price": b.nok(300000),
                    "fees": b.nok(0),
                    "delivery_months": b.inp(0),
                    "registered_on": "2027-01-01",
                    "loan": {
                        "annual_rate_pct": b.inp(12),
                        "term_months": 12,
                        "establishment_fee": b.nok(0),
                        "monthly_fee": b.nok(0),
                    },
                    "exit_friction_pct": b.inp(0),
                },
                "insurance": b.insurance(),
                "resale": b.resale_points(300000, {12: 270000, 24: 243000, 36: 218700, 48: 196830}),
            }
        ],
        user=b.user(down_payment_nok=200000, exit_odds={"p12": 100, "p24": 0, "p36": 0, "p48": 0}),
    )
    write(
        "g2_new_loan",
        g2,
        {
            "option": "new-loan",
            "loan_payment_ore": 888_488,
            "loan_total_interest_ore": 661_853,
            "cash_up_front_ore": 21_000_000,
            "tco_ore": {12: 6_586_853},
            "display_12_ore": {"value_lost": 3_000_000, "financing": 661_853},
        },
        "docs/cars/golden/g2_new_loan.md",
    )

    # G3: 36-month lease, early exit at 12, term end at 36, repeat lease at 48 -----
    g3 = b.scenario([b.lease()], user=b.user(exit_odds={"p12": 25, "p24": 0, "p36": 50, "p48": 25}))
    write(
        "g3_lease",
        g3,
        {
            "option": "lease-36",
            "cash_up_front_ore": 4_200_000,
            "tco_ore": {12: 18_825_000, 36: 29_476_000, 48: 45_601_000},
            "exit_items_ore": {
                12: {"early_exit": 6_000_000, "excess_km": 400_000, "exit_friction": 300_000},
                36: {"early_exit": 0, "excess_km": 1_200_000, "exit_friction": 300_000},
            },
            "lease_payments_estimate": True,
        },
        "docs/cars/golden/g3_lease.md",
    )

    # G4: opportunity cost and discounting in isolation -----------------------------
    g4 = b.scenario(
        [
            b.used_cash(
                id="opp",
                price_nok=100000,
                resale=b.resale_points(100000, {12: 100000, 24: 100000, 36: 100000, 48: 100000}),
                exit_friction_pct=b.inp(0),
            )
        ],
        user=b.user(return_on_cash_pct=12, exit_odds={"p12": 50, "p24": 50, "p36": 0, "p48": 0}),
        market=b.market("tax_rules_zero.yaml"),
    )
    g4["options"][0]["vehicle"].update(
        {
            "efficiency_wh_per_km": b.inp(0),
            "tyre_set": b.nok(0),
            "service_interval_months": 12,
            "service_price": b.nok(0),
            "wear_per_year": b.nok(0),
        }
    )
    g4["options"][0]["insurance"] = b.insurance(0)
    write(
        "g4_opportunity_npc",
        g4,
        {
            "option": "opp",
            "tco_ore": {12: 1_200_000, 24: 2_544_000},
            "npc_ore": {12: 1_071_429, 24: 2_028_061},
            "opportunity_ore": {12: 1_200_000, 24: 2_544_000},
        },
        "docs/cars/golden/g4_opportunity_npc.md",
    )

    # G5: used 5+ yr, private, delayed delivery with rental cost -------------------
    g5 = b.scenario(
        [
            b.used_cash(
                id="used-old",
                price_nok=150000,
                mode="used_5_plus",
                age_months=72,
                seller_type="private",
                delivery_months=b.inp(2),
                resale=b.resale_points(150000, {12: 135000, 24: 121500, 36: 109350, 48: 98415}),
            )
        ],
        user=b.user(exit_odds={"p12": 100, "p24": 0, "p36": 0, "p48": 0}),
        market=b.market(rental_per_month=b.nok(8000)),
    )
    write(
        "g5_used_old_delay",
        g5,
        {
            "option": "used-old",
            "cash_up_front_ore": 18_100_000,
            "tco_ore": {12: 7_201_000},
            "display_12_ore": {"delay": 1_600_000, "fees_and_taxes": 866_000},
        },
        "docs/cars/golden/g5_used_old_delay.md",
    )

    # G6: used with a 24-month loan, sold at 12 (payoff of the balance) ------------
    g6 = b.scenario(
        [
            b.used_cash(
                id="used-loan",
                price_nok=200000,
                exit_friction_pct=b.inp(0),
                loan={
                    "annual_rate_pct": b.inp(12),
                    "term_months": 24,
                    "establishment_fee": b.nok(0),
                    "monthly_fee": b.nok(0),
                },
            )
        ],
        user=b.user(down_payment_nok=100000, exit_odds={"p12": 100, "p24": 0, "p36": 0, "p48": 0}),
    )
    write(
        "g6_used_loan_payoff",
        g6,
        {
            "option": "used-loan",
            "loan_payment_ore": 470_735,
            "payoff_12_ore": 5_298_153,
            "payoff_tolerance_ore": 100,
            "tco_12_ore": 6_371_977,
            "tco_tolerance_ore": 100,
        },
        "docs/cars/golden/g6_used_loan_payoff.md",
    )
    print(f"wrote {len(list(OUT.glob('*.yaml')))} golden files to {OUT}")


if __name__ == "__main__":
    main()
