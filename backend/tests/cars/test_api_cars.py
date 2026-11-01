"""/api/cars endpoints (spec 022 R1, R9, R10): schema, limits, modes, privacy."""

from __future__ import annotations

import json
import re
import time

import pytest

from app.cars import data_bundle

PROFILE = {
    "exit_odds": {"p12": 15, "p24": 35, "p36": 35, "p48": 15},
    "km_per_year": 12000,
    "charging_mix": {"home_pct": 70, "work_free_pct": 20, "public_pct": 10},
    "pay_mode": "loan",
    "return_on_cash_pct": 4,
    "down_payment_nok": 100000,
    "insurance": {"age_band": "30-39", "claims_free_years": 0, "has_claims_free_letter": True},
    "limits": {"modes": ["new", "lease", "used_1_3", "used_5_plus"], "must_haves": []},
    "start_date": "2026-12-01",
}


def _req(**over):
    body = {
        "profile": dict(PROFILE),
        "selection": [
            {"variant_id": "tesla-model3-rwd", "year_from": 2021, "year_to": 2023},
            {"variant_id": "tesla-model3-rwd-highland", "year_from": 2024, "year_to": 2026},
            {"variant_id": "hyundai-ioniq5-lr-rwd", "year_from": 2021, "year_to": 2023},
            {"variant_id": "tesla-model3-lr-awd", "year_from": 2019, "year_to": 2020},
        ],
        "measure": "per_month",
        "seed": 7,
        "draws": 400,
        "overrides": {},
    }
    body.update(over)
    return body


def test_vehicles_lists_catalogue(client):
    r = client.get("/api/cars/vehicles")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) >= 8
    m3 = next(v for v in rows if v["variant_id"] == "tesla-model3-rwd")
    assert m3["model_years"] == [2021, 2022, 2023] and m3["new_price_ore"] > 0
    assert any(v["has_lease_offer"] for v in rows)


def test_cohorts_filters_and_fixture_listings_mode(client):
    r = client.get(
        "/api/cars/market/cohorts", params={"make": "Tesla", "year_from": 2022, "year_to": 2024}
    )
    assert r.status_code == 200
    data = r.json()
    assert data["listings_mode"] in ("fixture", "unavailable")
    assert data["cohorts"] and all(
        c["make"] == "Tesla" and 2022 <= c["model_year"] <= 2024 for c in data["cohorts"]
    )
    c = data["cohorts"][0]
    assert c["pi_low_ore"] <= c["value_ref_ore"] <= c["pi_high_ore"]
    r = client.get("/api/cars/market/cohorts", params={"must_have": ["awd"]})
    assert all(c["meets_must_haves"] == (c["drive"] == "awd") for c in r.json()["cohorts"])


def test_listings_endpoint_modes(client, make_client):
    cid = client.get("/api/cars/market/cohorts").json()["cohorts"][0]["cohort_id"]
    r = client.get(f"/api/cars/market/cohorts/{cid}/listings")
    if data_bundle.FIXTURE_LISTINGS.exists():
        assert r.status_code == 200 and r.json()["listings_mode"] == "fixture"
        for row in r.json()["listings"]:
            assert re.fullmatch(r"[0-9a-f]{16}", row["listing_id"])
    else:
        assert r.status_code == 503
    assert client.get("/api/cars/market/cohorts/nope:1999/listings").status_code == 404
    # Production without R2: unavailable, never the fixture.
    data_bundle.clear_cache()
    prod = make_client(static_dir="/nonexistent-static")
    assert prod.get(f"/api/cars/market/cohorts/{cid}/listings").status_code == 503
    data_bundle.clear_cache()


def test_scenario_runs_ranks_and_is_private(client):
    t0 = time.perf_counter()
    r = client.post("/api/cars/scenarios", json=_req())
    elapsed = time.perf_counter() - t0
    assert r.status_code == 200, r.text
    data = r.json()
    opts = data["options"]
    assert len(opts) >= 6
    kinds = {o["option_kind"] for o in opts}
    assert {"new", "lease", "used_1_3", "used_5_plus"} <= kinds
    exp = [o["result"]["measures"]["per_month"]["expected"]["p50"] for o in opts]
    assert exp == sorted(exp)
    first = opts[0]["result"]
    assert len(first["measures"]["tco"]["band"]["p50"]) == 61
    assert first["status"] in ("live", "estimate")
    assert all("label" in i and i["source"] and i["as_of"] for i in first["inputs"])
    assert data["sensitivity"] and data["sensitivity_option_id"] == first["option_id"]
    assert "bundle_as_of" in data and data["start_date"] == "2026-12-01"
    # Privacy: no registration numbers / VINs / secrets anywhere in the payload.
    text = json.dumps(data)
    assert not re.search(r"\b[A-Z]{2}\d{5}\b", text)
    assert "SECRET" not in text.upper() or "CARS_R2" not in text
    assert elapsed < 10  # generous CI bound; local runs are well under 2 s


def test_scenario_under_two_seconds_for_ten_options_at_2000_draws(client):
    body = _req(draws=2000)
    body["selection"] = [
        {"variant_id": "tesla-model3-rwd", "year_from": 2021, "year_to": 2023},
        {"variant_id": "hyundai-ioniq5-lr-rwd", "year_from": 2021, "year_to": 2023},
        {"variant_id": "skoda-enyaq-80-rwd", "year_from": 2021, "year_to": 2023},
        {"variant_id": "tesla-modely-lr-awd", "year_from": 2022, "year_to": 2024},
        {"variant_id": "tesla-model3-rwd-highland", "year_from": 2024, "year_to": 2026},
    ]
    client.post("/api/cars/vehicles")  # warm imports (405 is fine)
    r = client.post("/api/cars/scenarios", json=body)
    assert r.status_code == 200
    n = len(r.json()["options"])
    assert n >= 10, n
    assert r.json()["elapsed_ms"] < 2000, r.json()["elapsed_ms"]


def test_what_if_and_overrides_change_results_without_state(client):
    base = client.post("/api/cars/scenarios", json=_req()).json()
    top = base["options"][0]["result"]
    hi_rate = client.post("/api/cars/scenarios", json=_req(what_if={"loan_rate_pct": 12})).json()
    same = next(o for o in hi_rate["options"] if o["result"]["option_id"] == top["option_id"])
    if same["option_kind"] != "lease":
        assert (
            same["result"]["measures"]["tco"]["deterministic"][36]
            > top["measures"]["tco"]["deterministic"][36]
        )
    # Saved-assumption keys in overrides are honoured as what-if fields.
    via_override = client.post(
        "/api/cars/scenarios", json=_req(overrides={"loan_rate": 12, "used_price_drift_pct": -5})
    ).json()
    assert via_override["options"]
    # An input override replaces a value and flips its status to live.
    ins_id = next(i["id"] for i in top["inputs"] if i["id"].endswith("insurance_annual"))
    ov = client.post("/api/cars/scenarios", json=_req(overrides={ins_id: 2400000})).json()
    o2 = next(o for o in ov["options"] if o["result"]["option_id"] == top["option_id"])["result"]
    ins = next(i for i in o2["inputs"] if i["id"] == ins_id)
    assert ins["status"] == "live" and ins["source"] == "Your override"
    # And the baseline is unchanged afterwards (stateless).
    again = client.post("/api/cars/scenarios", json=_req()).json()
    assert (
        again["options"][0]["result"]["measures"]["tco"]["deterministic"]
        == top["measures"]["tco"]["deterministic"]
    )


def test_pay_mode_both_emits_cash_and_loan_pairs(client):
    body = _req()
    body["profile"]["pay_mode"] = "both"
    r = client.post("/api/cars/scenarios", json=body).json()
    ids = [o["result"]["option_id"] for o in r["options"]]
    assert any(i.endswith(":cash") for i in ids)
    labels = [o["result"]["label"] for o in r["options"]]
    assert any(label.endswith("paid cash") for label in labels)


def test_limits_rule_out_and_bad_selection_422(client):
    body = _req()
    body["profile"]["limits"] = {"modes": ["lease"], "must_haves": [], "max_price_nok": 1}
    r = client.post("/api/cars/scenarios", json=body).json()
    assert all(o["option_kind"] == "lease" for o in r["options"])
    body = _req(selection=[{"variant_id": "nope", "year_from": 2020, "year_to": 2021}])
    assert client.post("/api/cars/scenarios", json=body).status_code == 422
    body = _req()
    body["profile"]["exit_odds"] = {"p12": 50, "p24": 50, "p36": 50, "p48": 0}
    assert client.post("/api/cars/scenarios", json=body).status_code == 422


def test_sources_and_health_report_cars(client):
    s = client.get("/api/cars/sources").json()
    assert s["sources"] and any(p["id"] == "ev_vat_2027_proposed" for p in s["pending_rules"])
    assert "traffic_tax_2025" in s["unverified_rules"]
    h = client.get("/api/health").json()
    assert h["cars"]["bundle_as_of"] and h["cars"]["listings"] in ("fixture", "unavailable")


def test_openapi_lists_endpoints(client):
    paths = client.get("/openapi.json").json()["paths"]
    for p in (
        "/api/cars/vehicles",
        "/api/cars/market/cohorts",
        "/api/cars/scenarios",
        "/api/cars/sources",
    ):
        assert p in paths
    assert "/api/cars/market/cohorts/{cohort_id}/listings" in paths


@pytest.mark.parametrize("measure", ["tco", "npc", "cash_up_front", "per_km"])
def test_ranking_follows_measure(client, measure):
    r = client.post("/api/cars/scenarios", json=_req(measure=measure, draws=200)).json()
    exp = [o["result"]["measures"][measure]["expected"]["p50"] for o in r["options"]]
    assert exp == sorted(exp) and r["ranking_measure"] == measure


# ---- spec 023 R1: market points -------------------------------------------

IDENTIFYING_KEYS = {"url", "ad_id_or_url", "reg_number", "vin", "dealer_name", "location"}


def _keys(obj, acc: set[str]) -> set[str]:
    if isinstance(obj, dict):
        for k, v in obj.items():
            acc.add(k)
            _keys(v, acc)
    elif isinstance(obj, list):
        for v in obj:
            _keys(v, acc)
    return acc


def test_market_points_shape_and_privacy(client):
    r = client.get("/api/cars/market/points")
    assert r.status_code == 200
    data = r.json()
    assert data["listings_mode"] in ("fixture", "unavailable")
    assert data["n_points"] == len(data["points"])
    assert not (_keys(data, set()) & IDENTIFYING_KEYS)
    if data["listings_mode"] == "fixture":
        assert data["n_points"] > 0
        for p in data["points"]:
            assert re.fullmatch(r"[0-9a-f]{16}", p["listing_id"])
            assert p["cohort_id"] == f"{p['variant_id']}:{p['model_year']}"
            assert p["ask_ore"] > 0 and p["km"] >= 0
            assert p["seller_type"] in ("dealer", "private")
        # one row per listing, latest snapshot only
        ids = [p["listing_id"] for p in data["points"]]
        assert len(ids) == len(set(ids))
        cohort_ids = {
            c["cohort_id"] for c in client.get("/api/cars/market/cohorts").json()["cohorts"]
        }
        assert {p["cohort_id"] for p in data["points"]} <= cohort_ids


def test_market_points_filters(client):
    base = client.get("/api/cars/market/points").json()
    if base["listings_mode"] != "fixture":
        pytest.skip("fixture listings not available")
    tesla = client.get("/api/cars/market/points", params={"make": "tesla"}).json()
    assert tesla["n_points"] > 0 and all(
        p["variant_id"].startswith("tesla-") for p in tesla["points"]
    )
    years = client.get(
        "/api/cars/market/points", params={"year_from": 2022, "year_to": 2022}
    ).json()
    assert years["n_points"] > 0 and all(p["model_year"] == 2022 for p in years["points"])
    cheap = client.get("/api/cars/market/points", params={"max_price_nok": 250_000}).json()
    assert all(p["ask_ore"] <= 25_000_000 for p in cheap["points"])
    assert cheap["n_points"] < base["n_points"]
    awd = client.get("/api/cars/market/points", params={"must_have": ["awd"]}).json()
    vehicles = {v["variant_id"]: v for v in client.get("/api/cars/vehicles").json()}
    assert awd["n_points"] < base["n_points"]
    assert all(vehicles[p["variant_id"]]["drive"] == "awd" for p in awd["points"])
    none = client.get("/api/cars/market/points", params={"energy_type": ["ice"]}).json()
    assert none["n_points"] == 0


def test_market_points_unavailable_mode_is_empty_not_503(make_client):
    data_bundle.clear_cache()
    prod = make_client(static_dir="/nonexistent-static")
    try:
        r = prod.get("/api/cars/market/points")
        assert r.status_code == 200
        assert r.json()["listings_mode"] == "unavailable" and r.json()["points"] == []
    finally:
        data_bundle.clear_cache()
