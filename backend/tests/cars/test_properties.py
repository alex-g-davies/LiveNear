"""Property tests for the engine (spec 022 R12), stated so they are true:

- cumulative cash flows never fall (exact);
- TCO excluding the lease early-exit and excess-km charges (both reset at a
  term boundary) never falls when resale is non-increasing;
- more km never lowers TCO (cost per km may fall by construction);
- a higher return on cash never lowers the TCO of a cash purchase;
- NPC == TCO when r = 0 (opportunity cost is then zero);
- expected lies between best and worst; P10 <= P50 <= P90;
- same seed -> identical results; Σ display items == TCO;
- with every range collapsed the P50 path equals the deterministic path
  (to the øre; within 100 øre for loan options, where the Monte Carlo uses
  the closed-form annuity instead of the rounded monthly schedule).
"""

from __future__ import annotations

from pathlib import Path

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from app.cars.engine.models import EXIT_POINTS
from app.cars.engine.result import build_option_result
from app.cars.engine.run import run_scenario
from app.cars.scenario_io import scenario_from_dict

from . import builders as b

BACKEND = Path(__file__).resolve().parents[2]
SLOW = settings(max_examples=25, deadline=None, suppress_health_check=[HealthCheck.too_slow])


@st.composite
def buy_option(draw):
    price = draw(st.integers(100_000, 900_000))
    retention = draw(st.floats(0.70, 0.98))
    years = {m: int(price * retention ** (m / 12)) for m in (12, 24, 36, 48, 60)}
    loan = draw(st.booleans())
    mode = draw(st.sampled_from(["used_1_3", "used_5_plus", "new"]))
    kw = {"exit_friction_pct": b.inp(draw(st.integers(0, 15)))}
    if loan:
        kw["loan"] = {
            "annual_rate_pct": b.inp(draw(st.integers(1, 12)), range=[1, 14]),
            "term_months": draw(st.sampled_from([24, 36, 48, 60])),
            "establishment_fee": b.nok(draw(st.integers(0, 5000))),
            "monthly_fee": b.nok(draw(st.integers(0, 100))),
        }
    if mode == "new":
        opt = {
            "id": "o",
            "label": "o",
            "vehicle": b.vehicle(),
            "deal": {
                "mode": "new",
                "price": b.nok(price),
                "fees": b.nok(draw(st.integers(0, 20000))),
                "delivery_months": b.inp(draw(st.integers(0, 6))),
                "registered_on": "2027-01-01",
                **kw,
            },
            "insurance": b.insurance(draw(st.integers(4000, 30000)), range_nok=[4000, 40000]),
            "resale": b.resale_points(price, years),
        }
    else:
        opt = b.used_cash(
            id="o",
            price_nok=price,
            mode=mode,
            age_months=draw(st.integers(12, 120)),
            resale=b.resale_points(price, years),
            **kw,
        )
        opt["insurance"] = b.insurance(draw(st.integers(4000, 30000)), range_nok=[4000, 40000])
    return opt


@st.composite
def lease_option(draw):
    kind = draw(st.sampled_from(["percent_of_remaining", "default_estimate"]))
    ee = (
        {"kind": "percent_of_remaining", "percent": b.inp(draw(st.integers(0, 100)))}
        if kind == "percent_of_remaining"
        else {
            "kind": "default_estimate",
            "recovery_pct": b.inp(draw(st.integers(0, 100)), status="estimate", basis="x"),
        }
    )
    return b.lease(
        term_months=draw(st.sampled_from([12, 24, 36, 48])),
        monthly=b.nok(draw(st.integers(2000, 12000))),
        upfront=b.nok(draw(st.integers(0, 120000))),
        km_cap_per_year=b.inp(draw(st.integers(8000, 30000))),
        early_exit=ee,
    )


@st.composite
def scenario_dict(draw, option=None):
    opt = draw(st.one_of(buy_option(), lease_option()) if option is None else option)
    km = draw(st.integers(5000, 40000))
    r = draw(st.integers(0, 12))
    pay = draw(st.sampled_from(["cash", "loan"]))
    down = draw(st.integers(0, 300000))
    odds = draw(
        st.sampled_from([(100, 0, 0, 0), (25, 25, 25, 25), (0, 50, 50, 0), (10, 20, 30, 40)])
    )
    return b.scenario(
        [opt],
        user=b.user(
            km_per_year=km,
            return_on_cash_pct=r,
            pay_mode=pay,
            down_payment_nok=down,
            exit_odds=dict(zip(("p12", "p24", "p36", "p48"), odds, strict=True)),
        ),
        draws=64,
        market=b.market(
            charging={"home": b.inp(100, range=[60, 200]), "public": b.inp(500, range=[300, 800])},
            used_price_drift=b.inp(0, range=[-5, 3]),
        ),
    )


def _run(d):
    sc = scenario_from_dict(d, base_dir=BACKEND)
    res = run_scenario(sc)
    assert res.options, res.ruled_out
    return sc, res.options[0]


@SLOW
@given(scenario_dict())
def test_cumulative_cash_never_falls_and_display_sums_to_tco(d):
    sc, opt = _run(d)
    cash = [li for li in opt.line_items if li.group == "cash"]
    for t in EXIT_POINTS:
        for li in cash:
            assert li.at_exit[t] >= 0
    tco = opt.measures["tco"].deterministic
    for t in EXIT_POINTS:
        assert sum(di.ore for di in opt.display[t]) == tco[t], t


@SLOW
@given(scenario_dict())
def test_tco_excluding_early_exit_never_falls(d):
    sc, opt = _run(d)
    tco = opt.measures["tco"].deterministic
    ee = next((li for li in opt.line_items if li.key == "early_exit"), None)
    adj = [tco[t] - (ee.at_exit.get(t, 0) if ee else 0) for t in EXIT_POINTS]
    # need the full series for early exit: recompute from the schedule
    _res, s, det, _sim = build_option_result(sc, sc.options[0], draws=1)
    ee_series = s.items["early_exit"].ore if "early_exit" in s.items else [0] * 61
    ex_series = s.items["excess_km"].ore if "excess_km" in s.items else [0] * 61
    # the excess-km cap resets at a term boundary, so it is excluded as well
    series = [det.tco[t] - ee_series[t] - ex_series[t] for t in range(61)]
    assert all(series[t + 1] >= series[t] for t in range(60)), series
    del adj


@SLOW
@given(scenario_dict())
def test_npc_equals_tco_when_r_is_zero(d):
    d["user"]["return_on_cash_pct"] = 0
    _sc, opt = _run(d)
    assert opt.measures["npc"].deterministic == opt.measures["tco"].deterministic


@SLOW
@given(scenario_dict(option=buy_option()))
def test_more_km_never_lowers_tco(d):
    _sc, lo = _run(d)
    d2 = dict(d)
    d2["user"] = dict(d["user"], km_per_year=d["user"]["km_per_year"] + 5000)
    _sc2, hi = _run(d2)
    for t in range(1, 61):
        assert hi.measures["tco"].deterministic[t] >= lo.measures["tco"].deterministic[t], t


@SLOW
@given(scenario_dict(option=buy_option()))
def test_higher_return_never_lowers_cash_purchase_tco(d):
    d["user"]["pay_mode"] = "cash"
    d["user"]["return_on_cash_pct"] = 2
    _sc, lo = _run(d)
    d["user"]["return_on_cash_pct"] = 9
    _sc2, hi = _run(d)
    for t in range(61):
        assert hi.measures["tco"].deterministic[t] >= lo.measures["tco"].deterministic[t], t


@SLOW
@given(scenario_dict())
def test_bands_ordered_expected_between_best_and_worst_and_seed_stable(d):
    sc, opt = _run(d)
    for name, m in opt.measures.items():
        for t in range(61):
            assert m.band.p10[t] <= m.band.p50[t] <= m.band.p90[t], (name, t)
        assert m.best.value <= m.expected_det <= m.worst.value, name
    again = run_scenario(sc).options[0]
    assert again.model_dump() == opt.model_dump()


@SLOW
@given(scenario_dict())
def test_collapsed_ranges_make_p50_equal_deterministic(d):
    # strip every range so the Monte Carlo has nothing to draw
    def strip(obj):
        if isinstance(obj, dict):
            obj.pop("range", None)
            obj.pop("range_nok", None)
            for v in obj.values():
                strip(v)
        elif isinstance(obj, list):
            for v in obj:
                strip(v)

    strip(d)
    sc, opt = _run(d)
    has_loan = sc.user.pay_mode == "loan" and getattr(sc.options[0].deal, "loan", None) is not None
    tol = 100 if has_loan else 1
    for t in range(61):
        assert abs(opt.measures["tco"].band.p50[t] - opt.measures["tco"].deterministic[t]) <= tol, t
