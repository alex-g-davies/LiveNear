"""Golden cases (spec 022 R12): YAML inputs + hand-worked expected outputs.

Each file under scenarios/golden/ names the markdown page where its numbers
were worked by hand. Deterministic amounts must match to the øre unless the
file states a tolerance (loan cases: closed-form check vs monthly rounding).
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from app.cars.engine.run import run_scenario
from app.cars.scenario_io import scenario_from_dict

BACKEND = Path(__file__).resolve().parents[2]
GOLDEN = BACKEND / "scenarios" / "golden"
CASES = sorted(GOLDEN.glob("*.yaml"))


def _load(path: Path) -> tuple[dict, dict]:
    doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert (BACKEND / doc["worked_in"]).exists(), f"{path.name}: worked example missing"
    return doc["inputs"], doc["expected"]


@pytest.mark.parametrize("path", CASES, ids=[p.stem for p in CASES])
def test_golden_case(path: Path) -> None:
    inputs, exp = _load(path)
    sc = scenario_from_dict(inputs, base_dir=BACKEND)
    res = run_scenario(sc)
    opt = next(o for o in res.options if o.option_id == exp["option"])
    tol = int(exp.get("tco_tolerance_ore", 0))

    if "cash_up_front_ore" in exp:
        assert opt.cash_up_front == exp["cash_up_front_ore"]
    for t, v in exp.get("tco_ore", {}).items():
        assert abs(opt.measures["tco"].deterministic[int(t)] - v) <= tol, f"tco at {t}"
    for t, v in exp.get("npc_ore", {}).items():
        assert abs(opt.measures["npc"].deterministic[int(t)] - v) <= tol, f"npc at {t}"
    for t, v in exp.get("per_month_ore", {}).items():
        assert opt.measures["per_month"].deterministic[int(t)] == v, f"per_month at {t}"
    for t, v in exp.get("per_km_ore", {}).items():
        assert opt.measures["per_km"].deterministic[int(t)] == v, f"per_km at {t}"
    if "expected_tco_ore" in exp:
        assert opt.measures["tco"].expected.p50 == exp["expected_tco_ore"]
    for key in ("display_12_ore", "display_36_ore"):
        if key in exp:
            t = int(key.split("_")[1])
            got = {d.key: d.ore for d in opt.display[t]}
            for k, v in exp[key].items():
                assert got[k] == v, f"{key}.{k}: {got[k]} != {v}"
    if "exit_items_ore" in exp:
        items = {li.key: li for li in opt.line_items}
        for t, by_item in exp["exit_items_ore"].items():
            for k, v in by_item.items():
                assert items[k].at_exit[int(t)] == v, f"{k} at {t}"
    if "opportunity_ore" in exp:
        opp = {d.key: d.ore for t in (12, 24) for d in opt.display.get(t, [])}
        for t, v in exp["opportunity_ore"].items():
            got = next(d.ore for d in opt.display[int(t)] if d.key == "opportunity_cost")
            assert got == v, f"opportunity at {t}"
        del opp
    if exp.get("lease_payments_estimate"):
        li = next(li for li in opt.line_items if li.key == "lease_payments")
        assert li.estimate is True
    if "tco_12_ore" in exp:
        assert abs(opt.measures["tco"].deterministic[12] - exp["tco_12_ore"]) <= tol


def test_g2_loan_rows_match_textbook() -> None:
    """100 000 at 12 % nominal over 12 months: payment 8 884,88 — the classic
    amortisation example. Exact arithmetic gives total interest 6 618,55; with
    each month's interest rounded to the øre and the last payment absorbing the
    residual (the bank convention this engine documents) it is 6 618,53."""
    from decimal import Decimal

    from app.cars.engine.finance import amortise, annuity_payment, payoff

    assert annuity_payment(10_000_000, Decimal(12), 12) == 888_488
    rows = amortise(10_000_000, Decimal(12), 12)
    assert (
        rows[0].interest == 100_000
        and rows[0].principal == 788_488
        and rows[0].balance == 9_211_512
    )
    assert rows[1].interest == 92_115
    assert sum(r.principal for r in rows) == 10_000_000
    assert sum(r.interest for r in rows) == 661_853
    assert rows[-1].payment == 888_485
    assert rows[-1].balance == 0
    assert payoff(rows, 0) == 10_000_000 and payoff(rows, 12) == 0


def test_g6_payoff_within_tolerance() -> None:
    inputs, exp = _load(GOLDEN / "g6_used_loan_payoff.yaml")
    sc = scenario_from_dict(inputs, base_dir=BACKEND)
    res = run_scenario(sc)
    opt = res.options[0]
    po = next(li for li in opt.line_items if li.key == "loan_payoff")
    assert abs(po.at_exit[12] - exp["payoff_12_ore"]) <= exp["payoff_tolerance_ore"]
    lp = next(li for li in opt.line_items if li.key == "loan_payments")
    assert lp.at_exit[12] == 12 * exp["loan_payment_ore"]
