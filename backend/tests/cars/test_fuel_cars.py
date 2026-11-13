"""Fuel cars in the engine (spec 029 R1-R4); golden cases g8 and g9 hold the
hand-worked numbers, these tests cover the guards and the uncertainty."""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from app.cars.engine.run import run_scenario
from app.cars.rules import load_toll_rings
from app.cars.scenario_io import scenario_from_dict

from . import builders as b

BACKEND = Path(__file__).resolve().parents[2]


def _hybrid_option(**veh_over):
    o = b.used_cash(id="hybrid")
    v = b.vehicle(
        variant_id="fx-hybrid",
        energy_type="hybrid",
        fuel="petrol",
        fuel_l_per_100km=b.inp(5.0),
        heat_pump=False,
    )
    del v["efficiency_wh_per_km"]
    v.update(veh_over)
    o["vehicle"] = v
    return o


def _with_fuel(d, petrol=b.nok(20), diesel=b.nok(22)):
    d["market"]["fuel_prices"] = {"petrol": petrol, "diesel": diesel}
    return d


def _run(d):
    return run_scenario(scenario_from_dict(d, base_dir=BACKEND))


def test_fuel_car_needs_fuel_and_consumption():
    o = _hybrid_option()
    del o["vehicle"]["fuel_l_per_100km"]
    with pytest.raises(ValidationError, match="fuel_l_per_100km"):
        scenario_from_dict(_with_fuel(b.scenario([o])), base_dir=BACKEND)


def test_electric_car_still_needs_efficiency():
    o = b.used_cash()
    del o["vehicle"]["efficiency_wh_per_km"]
    with pytest.raises(ValidationError, match="efficiency_wh_per_km"):
        scenario_from_dict(b.scenario([o]), base_dir=BACKEND)


def test_fuel_car_without_fuel_prices_fails_loudly():
    with pytest.raises(ValidationError, match="no fuel prices"):
        scenario_from_dict(b.scenario([_hybrid_option()]), base_dir=BACKEND)


def test_charging_mix_does_not_move_a_fuel_car():
    def energy(mix):
        d = _with_fuel(b.scenario([_hybrid_option()]))
        d["user"]["charging_mix"] = mix
        opt = _run(d).options[0]
        return next(x.ore for x in opt.display[36] if x.key == "energy")

    home = energy({"home_pct": 100, "work_free_pct": 0, "public_pct": 0})
    public = energy({"home_pct": 0, "work_free_pct": 0, "public_pct": 100})
    assert home == public == 36 * 100_000  # 50 l a month at 20 kr


def test_fuel_price_range_widens_the_band_and_ev_draws_are_unchanged():
    ev = b.used_cash(id="ev")
    plain = _run(_with_fuel(b.scenario([ev, _hybrid_option()])))
    ranged = _run(
        _with_fuel(b.scenario([ev, _hybrid_option()]), petrol=b.nok(20, range_nok=[17, 24]))
    )
    hyb_plain = plain.options[1].measures["tco"].band
    hyb_ranged = ranged.options[1].measures["tco"].band
    assert hyb_plain.p10[36] == hyb_plain.p90[36]
    assert hyb_ranged.p10[36] < hyb_ranged.p50[36] < hyb_ranged.p90[36]
    # The fuel draw comes last on the shared stream, so the EV is untouched.
    assert plain.options[0].measures["tco"].band == ranged.options[0].measures["tco"].band


def test_shipped_toll_rings_have_petrol_and_diesel_rates():
    for muni, ring in load_toll_rings().items():
        assert {"petrol", "diesel"} <= set(ring.fuel_rates), muni
        for rates in ring.fuel_rates.values():
            # A fuel car never pays less than an electric car in these rings.
            assert rates.offpeak_ore.value >= ring.offpeak_ore.value, muni
            assert rates.rush_ore.value >= ring.rush_ore.value, muni


def test_ring_without_the_cars_fuel_rate_fails_loudly():
    d = _with_fuel(b.scenario([_hybrid_option()]))
    d["user"]["toll_passages_per_week"] = 5
    d["market"]["toll_ring"] = {
        "name": "EV-only ring",
        "offpeak": b.nok(10),
        "rush": b.nok(10),
        "source": b.inp("fixture ring", kind="str"),
    }
    with pytest.raises(LookupError, match="no petrol rate"):
        _run(d)


def test_overrides_reach_fuel_price_and_fuel_toll_rates():
    from datetime import date

    from app.cars.engine.overrides import apply_input_overrides

    d = _with_fuel(b.scenario([_hybrid_option()]))
    d["user"]["toll_passages_per_week"] = 6
    d["market"]["toll_ring"] = {
        "name": "Fixture ring",
        "offpeak": b.nok(10),
        "rush": b.nok(10),
        "source": b.inp("fixture ring", kind="str"),
        "fuel_rates": {"petrol": {"offpeak": b.nok(20), "rush": b.nok(20)}},
    }
    sc = scenario_from_dict(d, base_dir=BACKEND)
    over = apply_input_overrides(
        sc,
        {"market.fuel_petrol": 3000, "market.toll_petrol_offpeak": 4000},
        date(2027, 1, 1),
    )
    before = {x.key: x.ore for x in run_scenario(sc).options[0].display[12]}
    after = {x.key: x.ore for x in run_scenario(over).options[0].display[12]}
    assert after["energy"] == before["energy"] * 3 // 2  # 20 -> 30 kr/l
    assert after["tolls"] > before["tolls"]
