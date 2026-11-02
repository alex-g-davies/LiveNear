"""Spec 024 R1-R5: service by interval, wear and repairs, inspection, wheel
changes and tolls. Unit checks on the schedule; the hand-worked numbers live
in the g7 golden case."""

from __future__ import annotations

from pathlib import Path

from app.cars.engine.run import run_scenario
from app.cars.scenario_io import scenario_from_dict

from . import builders as b

BACKEND = Path(__file__).resolve().parents[2]


def _items(d: dict) -> dict:
    sc = scenario_from_dict(d, base_dir=BACKEND)
    res = run_scenario(sc)
    opt = res.options[0]
    return {li.key: li for li in opt.line_items}, opt


def _cum(li, t: int) -> int:
    return li.at_exit[t]


# ------------------------------------------------------------------ service (R1)


def test_service_first_visit_price_and_km_interval_for_a_new_car():
    # New car: first service at 12 months for 2 490, then every 24 months / 25 000 km
    # for 4 290. At 24 000 km/yr (2 000/month) the km rule fires first: 25 000 km
    # after month 12 is month 24.5 -> month 25, then month 38 (50 000 km).
    veh = b.vehicle(
        service_interval_months=24,
        service_interval_km=25000,
        service_first_months=12,
        service_price=b.nok(4290),
        service_first_price=b.nok(2490),
    )
    opt = {
        "id": "new",
        "label": "new",
        "vehicle": veh,
        "deal": {
            "mode": "new",
            "price": b.nok(300000),
            "fees": b.nok(0),
            "delivery_months": b.inp(0),
            "registered_on": "2027-01-01",
            "exit_friction_pct": b.inp(0),
        },
        "insurance": b.insurance(),
        "resale": b.resale_points(300000, {12: 250000, 24: 220000, 36: 200000, 48: 180000}),
    }
    d = b.scenario([opt], user=b.user(km_per_year=24000, pay_mode="cash"))
    items, _ = _items(d)
    sv = items["service"]
    assert _cum(sv, 12) == 249_000  # first service, cheaper
    assert _cum(sv, 24) == 249_000  # nothing between
    assert _cum(sv, 36) == 249_000 + 429_000  # month 25 by km
    assert _cum(sv, 48) == 249_000 + 2 * 429_000  # month 38 by km
    assert sv.estimate is False


def test_used_car_from_a_private_seller_flags_service_as_estimate():
    d = b.scenario([b.used_cash(seller_type="private")], user=b.user(pay_mode="cash"))
    items, _ = _items(d)
    assert items["service"].estimate is True
    d = b.scenario([b.used_cash(seller_type="dealer")], user=b.user(pay_mode="cash"))
    items, _ = _items(d)
    assert items["service"].estimate is False


def test_no_fixed_interval_means_no_service_events_only_wear():
    veh = b.vehicle(service_interval_months=0, service_price=b.nok(0), wear_per_year=b.nok(1800))
    opt = b.used_cash()
    opt["vehicle"] = veh
    items, _ = _items(b.scenario([opt], user=b.user(pay_mode="cash")))
    assert _cum(items["service"], 48) == 0
    assert _cum(items["wear_and_repairs"], 12) == 180_000


def test_lease_that_includes_service_has_no_service_or_wear_cost():
    opt = b.lease(includes=["service"])
    opt["vehicle"] = b.vehicle(wear_per_year=b.nok(1200))
    items, _ = _items(b.scenario([opt]))
    assert _cum(items["service"], 36) == 0
    assert _cum(items["wear_and_repairs"], 36) == 0


# ------------------------------------------------------- wear and repairs (R2)


def test_repair_allowance_rises_with_the_odometer_and_drops_under_warranty():
    repair = b.repair(bands=[[50000, 10], [999999999, 100]], ev_factor=1, in_warranty_factor=0.5)
    # Used car at 40 000 km, 12 months old, warranty 5 yr / 100 000 km: in
    # warranty until month 48 by age (odometer 100 000 at month 60).
    opt = b.used_cash(age_months=12)
    opt["vehicle"] = b.vehicle(wear_per_year=b.nok(0), warranty_years=5, warranty_km=100000)
    d = b.scenario([opt], user=b.user(pay_mode="cash"), market=b.market(repair=repair))
    items, _ = _items(d)
    wr = items["wear_and_repairs"]
    # months 1-10: odometer 41 000-50 000 -> 10 øre/km × 1 000 km × 0.5 = 5 000 øre
    assert _cum(wr, 12) == 10 * 5_000 + 2 * 50_000  # months 11-12 at 100 øre/km × 0.5
    # months 13-48 at 50 000 øre (in warranty), 49-60 at 100 000 (out of warranty)
    assert _cum(wr, 48) == _cum(wr, 12) + 36 * 50_000
    assert wr.at_exit[48] < _cum(wr, 48) + 12 * 100_000 + 1  # sanity on the final year


def test_more_km_never_lowers_the_repair_allowance():
    repair = b.repair(bands=[[20000, 11], [60000, 34], [999999999, 96]], ev_factor=0.65)
    totals = []
    for km in (5000, 12000, 20000, 40000):
        d = b.scenario(
            [b.used_cash()],
            user=b.user(km_per_year=km, pay_mode="cash"),
            market=b.market(repair=repair),
        )
        items, _ = _items(d)
        totals.append(_cum(items["wear_and_repairs"], 48))
    assert totals == sorted(totals) and totals[0] < totals[-1]


# -------------------------------------------------------------- inspection (R3)


def test_inspection_follows_the_rule_cycle_from_first_registration():
    d = b.scenario(
        [b.used_cash(age_months=30)],
        user=b.user(pay_mode="cash"),
        market=b.market(inspection_fee=b.nok(1500)),
    )
    items, opt = _items(d)
    insp = items["inspection"]
    # age 30 at month 0: inspections at ages 48 (month 18), 72 (month 42)
    assert _cum(insp, 12) == 0
    assert _cum(insp, 24) == 150_000
    assert _cum(insp, 36) == 150_000
    assert _cum(insp, 48) == 300_000
    rule_inputs = [i for i in opt.inputs if i.id.startswith("fx_periodic_inspection")]
    assert rule_inputs and rule_inputs[0].label == "Inspection cycle rule"


# ------------------------------------------------------------------- tyres (R4)


def test_wheel_changes_twice_a_year_unless_the_lease_includes_tyres():
    d = b.scenario(
        [b.used_cash()], user=b.user(pay_mode="cash"), market=b.market(wheel_change=b.nok(600))
    )
    items, _ = _items(d)
    assert _cum(items["tyres"], 12) == 1_000_000 + 2 * 60_000
    opt = b.lease(includes=["tyres"])
    items, _ = _items(b.scenario([opt], market=b.market(wheel_change=b.nok(600))))
    assert _cum(items["tyres"], 12) == 0


# ------------------------------------------------------------------- tolls (R5)


def _ring(cap: int = 0) -> dict:
    return {
        "name": "fixture ring",
        "offpeak": b.nok(20),
        "rush": b.nok(30),
        "monthly_cap": cap,
        "source": b.inp("fixture ring", kind="str", status="estimate", basis="50/50 blend"),
    }


def test_tolls_blend_rates_and_apply_the_monthly_cap():
    d = b.scenario(
        [b.used_cash()],
        user=b.user(pay_mode="cash", toll_passages_per_week=10),
        market=b.market(toll_ring=_ring(cap=120)),
    )
    items, opt = _items(d)
    assert _cum(items["tolls"], 12) == 12 * 108_333  # 43.33 passages × 25 kr
    assert items["tolls"].estimate is True  # the blend is an assumption by design
    # 50 a week = 216.7 a month, capped at 120 × 25 kr = 3 000 kr
    d["user"]["toll_passages_per_week"] = 50
    items, _ = _items(d)
    assert _cum(items["tolls"], 12) == 12 * 300_000
    # No ring on file, or no passages: zero and not an estimate
    d["market"]["toll_ring"] = None
    items, _ = _items(d)
    assert _cum(items["tolls"], 48) == 0 and items["tolls"].estimate is False


def test_display_rows_group_service_items_and_show_tolls():
    d = b.scenario(
        [b.used_cash()],
        user=b.user(pay_mode="cash", toll_passages_per_week=5),
        market=b.market(inspection_fee=b.nok(1500), toll_ring=_ring()),
    )
    items, opt = _items(d)
    rows = {r.key: r for r in opt.display[36]}
    assert rows["service"].label == "Service and repairs"
    assert rows["service"].ore == (
        _cum(items["service"], 36)
        + _cum(items["wear_and_repairs"], 36)
        + _cum(items["inspection"], 36)
    )
    assert rows["tolls"].ore == _cum(items["tolls"], 36) > 0
