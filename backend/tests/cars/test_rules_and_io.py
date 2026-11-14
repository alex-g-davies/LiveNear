"""Tax rules (R6), overrides (R10/R11), scenario loading and CLI (R3)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from app.cars.engine.cli import main as cli_main
from app.cars.engine.defaults import default_insurance
from app.cars.engine.models import InsuranceProfile
from app.cars.engine.overrides import WhatIf, apply_input_overrides, apply_what_if
from app.cars.engine.run import run_scenario
from app.cars.rules import load_tax_rules, pending_rules
from app.cars.rules.loader import RULES_FILE
from app.cars.scenario_io import load_scenario, scenario_from_dict

from . import builders as b

BACKEND = Path(__file__).resolve().parents[2]
FIX = Path(__file__).parent / "fixtures"


def test_rule_lookup_single_and_carry_forward():
    rules = load_tax_rules(FIX / "tax_rules_fixture.yaml")
    rule, carried = rules.rule_at("traffic_insurance_tax", date(2027, 5, 1))
    assert rule.id == "fx_traffic_tax" and carried is False
    with pytest.raises(LookupError):
        rules.rule_at("traffic_insurance_tax", date(2019, 1, 1))
    with pytest.raises(LookupError):
        rules.rule_at("nope", date(2027, 1, 1))


def test_real_rules_file_loads_and_2027_vat_is_pending_not_applied():
    rules = load_tax_rules(RULES_FILE)
    kinds = {r.kind for r in rules.rules}
    assert kinds == {
        "traffic_insurance_tax",
        "re_registration_fee",
        "ev_vat",
        "periodic_inspection",
    }
    vat, carried = rules.rule_at("ev_vat", date(2027, 6, 1))
    assert vat.id == "ev_vat_2023" and vat.params["threshold_ore"] == 50_000_000
    pend = pending_rules(RULES_FILE)
    assert any(p["id"] == "ev_vat_2027_proposed" and p["status"] == "unverified" for p in pend)
    # Past the last dated traffic-tax rule the lookup carries forward and says so.
    rule, carried = rules.rule_at("traffic_insurance_tax", date(2031, 1, 1))
    assert rule.id == "traffic_tax_2026" and carried is False  # open-ended rule, in force
    for r in rules.rules:
        assert r.source_url.startswith("http")


def test_overlapping_rules_are_rejected():
    with pytest.raises(ValueError, match="overlap"):
        load_tax_rules(FIX / "tax_rules_overlap.yaml")


def test_unverified_rule_makes_option_estimate(tmp_path):
    """An unverified rule makes the option Estimate even when every other input
    is live. Every shipped rule is now live (029 R3), so the test marks the 2025
    traffic-tax rule unverified in a copy of the rules file."""
    text = RULES_FILE.read_text(encoding="utf-8")
    head, tail = text.split("id: traffic_tax_2025", 1)
    tail = tail.replace("status: live", "status: unverified", 1)
    rules = tmp_path / "tax_rules.yaml"
    rules.write_text(head + "id: traffic_tax_2025" + tail, encoding="utf-8")
    d = b.scenario([b.used_cash(purchase_date="2025-06-01")], market=b.market())
    d["market"]["tax_rules"] = str(rules)
    d["user"]["start_date"] = "2025-06-01"
    d["user"]["return_on_cash_pct"] = 0
    d["market"]["materiality_threshold"] = b.inp(0.01)
    sc = scenario_from_dict(d, base_dir=BACKEND)
    opt = run_scenario(sc).options[0]
    assert opt.status == "estimate"
    assert any(i.startswith("traffic_tax_") for i in opt.material_estimates)


def test_checked_2026_rules_give_live_option():
    """From 1 Mar 2026 the traffic tax and the 2026 re-registration table are
    live, so the same scenario started in 2027 carries no rule-based estimate."""
    d = b.scenario([b.used_cash()], market=b.market())
    d["market"]["tax_rules"] = str(RULES_FILE)
    d["user"]["return_on_cash_pct"] = 0
    d["market"]["materiality_threshold"] = b.inp(0.01)
    opt = run_scenario(scenario_from_dict(d, base_dir=BACKEND)).options[0]
    assert not any(
        i.startswith(("traffic_tax_", "re_registration_")) for i in opt.material_estimates
    )


def test_live_fixture_rules_give_live_option():
    d = b.scenario([b.used_cash()])
    opt = run_scenario(scenario_from_dict(d, base_dir=BACKEND)).options[0]
    assert opt.status == "live" and opt.material_estimates == []


def test_input_override_replaces_value_and_marks_live():
    d = b.scenario([b.used_cash()])
    d["options"][0]["insurance"]["annual"].update({"status": "estimate", "basis": "guess"})
    d["market"]["materiality_threshold"] = b.inp(0.01)
    sc = scenario_from_dict(d, base_dir=BACKEND)
    before = run_scenario(sc).options[0]
    assert before.status == "estimate"
    sc2 = apply_input_overrides(sc, {"used-cash.insurance_annual": 2_400_000}, date(2026, 11, 1))
    after = run_scenario(sc2).options[0]
    assert after.status == "live"
    ins = next(i for i in after.inputs if i.id == "used-cash.insurance_annual")
    assert ins.value == "2400000" and ins.source == "Your override" and ins.status == "live"
    assert (
        after.measures["tco"].deterministic[12]
        == before.measures["tco"].deterministic[12] + 1_200_000
    )
    assert sc is not sc2 and run_scenario(sc).options[0].status == "estimate"  # original untouched


def test_what_if_changes_rate_km_return_and_pay_mode():
    d = b.scenario(
        [
            b.used_cash(
                loan={
                    "annual_rate_pct": b.inp(6),
                    "term_months": 36,
                    "establishment_fee": b.nok(0),
                    "monthly_fee": b.nok(0),
                }
            )
        ]
    )
    sc = scenario_from_dict(d, base_dir=BACKEND)
    base = run_scenario(sc).options[0].measures["tco"].deterministic[12]
    w = apply_what_if(sc, WhatIf(loan_rate_pct=Decimal(10)), date(2026, 11, 1))
    assert run_scenario(w).options[0].measures["tco"].deterministic[12] > base
    w = apply_what_if(sc, WhatIf(km_per_year=24000), date(2026, 11, 1))
    assert run_scenario(w).options[0].measures["tco"].deterministic[12] > base
    w = apply_what_if(sc, WhatIf(pay_mode="cash", return_on_cash_pct=Decimal(0)), date(2026, 11, 1))
    cash = run_scenario(w).options[0]
    assert all(li.key != "loan_payments" for li in cash.line_items)
    w = apply_what_if(sc, WhatIf(used_price_drift_pct=Decimal(-5)), date(2026, 11, 1))
    assert w.market.used_price_drift.value == Decimal(-5)


def test_limits_rule_out_with_reasons():
    d = b.scenario([b.used_cash(), b.lease()])
    d["user"]["limits"] = {
        "max_price_nok": 150000,
        "must_haves": ["awd"],
        "modes": ["used_1_3", "lease"],
    }
    res = run_scenario(scenario_from_dict(d, base_dir=BACKEND))
    assert len(res.options) == 0
    reasons = {r.option_id: r.reasons for r in res.ruled_out}
    assert "over your max price" in reasons["used-cash"] and "not AWD" in reasons["used-cash"]
    assert reasons["lease-36"] == ["not AWD"]


def test_default_insurance_is_an_estimate_with_basis():
    p = InsuranceProfile(age_band="25-29", claims_free_years=0, has_claims_free_letter=False)
    i = default_insurance(p, 35_000_000, "x")
    assert i.status == "estimate" and i.basis and i.range is not None
    assert i.value == 1_200_000 * 13 // 10 * 16 // 10  # 12 000 × 1.3 × 1.6 NOK, in øre


def test_example_scenario_loads_and_cli_runs(capsys):
    sc = load_scenario(BACKEND / "scenarios" / "example.yaml")
    assert len(sc.options) == 4
    assert cli_main([str(BACKEND / "scenarios" / "example.yaml"), "--exit", "36"]) == 0
    out = capsys.readouterr().out
    assert "Net cost per month" in out and "where the money goes at month 36" in out
    assert "Estimate because of" in out  # placeholders are flagged, never silent
