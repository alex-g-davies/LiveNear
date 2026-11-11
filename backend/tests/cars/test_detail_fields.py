"""Detail-page fields (spec 024 follow-up): display series for every month,
purchase price, resale band, and input values formatted with units."""

from __future__ import annotations

from decimal import Decimal

from app.cars.engine.models import MONTHS
from app.cars.engine.result import display_value, fmt_kr, input_unit

from .test_api_cars import PROFILE


def _scenario(client, selection):
    body = {
        "profile": dict(PROFILE),
        "selection": selection,
        "overrides": {},
        "measure": "per_month",
        "seed": 1,
        "draws": 200,
    }
    r = client.post("/api/cars/scenarios", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_display_series_sums_to_tco_at_every_month(client):
    data = _scenario(
        client,
        [
            {"variant_id": "nissan-leaf-40", "year_from": 2019, "year_to": 2019},
            {"variant_id": "vw-id3-pro-58", "year_from": 2023, "year_to": 2023},
        ],
    )
    assert data["options"]
    for o in data["options"]:
        res = o["result"]
        series = res["display_series"]
        assert set(series) == {d["key"] for d in res["display"]["36"]}
        tco = res["measures"]["tco"]["deterministic"]
        for t in range(MONTHS):
            assert sum(v[t] for v in series.values()) == tco[t], (res["option_id"], t)
        # The four exit points agree with the older per-exit rows.
        for t in ("12", "24", "36", "48"):
            assert {d["key"]: d["ore"] for d in res["display"][t]} == {
                k: v[int(t)] for k, v in series.items()
            }


def test_purchase_price_and_resale_band(client):
    data = _scenario(client, [{"variant_id": "nissan-leaf-40", "year_from": 2019, "year_to": 2019}])
    res = data["options"][0]["result"]
    price = next(i for i in res["inputs"] if i["id"].endswith(".price"))
    assert res["purchase_price"] == int(price["value"])
    band = res["resale_band"]
    assert band is not None and band["p50"] == res["resale_p50"]
    for t in range(MONTHS):
        assert band["p10"][t] <= band["p50"][t] <= band["p90"][t]
    # Value lost at an exit is price minus the P50 sale value plus the exit friction.
    value_lost = res["display_series"]["value_lost"][30]
    assert value_lost >= res["purchase_price"] - band["p50"][30]


def test_lease_has_no_purchase_price_or_resale(client):
    data = _scenario(client, [{"variant_id": "mg-mg4-64", "year_from": 2026, "year_to": 2026}])
    leases = [o for o in data["options"] if o["option_kind"] == "lease"]
    assert leases, [o["option_kind"] for o in data["options"]]
    res = leases[0]["result"]
    assert res["purchase_price"] is None and res["resale_band"] is None
    assert "lease_payments" in res["display_series"]


def test_inputs_carry_units_and_display_values(client):
    data = _scenario(client, [{"variant_id": "nissan-leaf-40", "year_from": 2019, "year_to": 2019}])
    inputs = {i["label"]: i for i in data["options"][0]["result"]["inputs"]}
    price = inputs["Purchase price"]
    assert price["unit"] == "kr" and price["display_value"].endswith(" kr")
    assert "," not in price["display_value"]  # whole kroner, not øre
    ins = inputs["Insurance (per year)"]
    assert ins["unit"] == "kr/year"
    assert ins["display_range"] is not None and ins["display_range"][0].endswith("kr/year")
    assert inputs["Loan rate"]["display_value"] == "6,9 %"
    assert inputs["Traffic insurance tax rule"]["display_value"].startswith(
        "Electric 9,16\u00a0kr/day"
    )
    assert inputs["Resale value path"]["unit"] is None


def test_formatting_helpers():
    assert fmt_kr(13130779) == "131 308"
    assert fmt_kr(916) == "9,16"
    assert fmt_kr(60000) == "600"
    assert fmt_kr(-250000) == "-2 500"
    assert display_value(Decimal("756000"), "kr/year") == "7 560 kr/year"
    assert display_value(Decimal("6.9"), "%") == "6,9 %"
    # 027 R5: dict keys become words, never config keys.
    assert display_value({"ev": 916, "ice": 652}, "kr/day") == (
        "Electric 9,16\u00a0kr/day, petrol or diesel 6,52\u00a0kr/day"
    )
    assert display_value({"first_after_months": 48, "every_months": 24}, "months") == (
        "First at 48\u00a0months, then every 24\u00a0months"
    )
    assert input_unit("x.price", 1) == "kr"
    assert input_unit("traffic_tax_2026", {}) == "kr/day"
    assert input_unit("market.v.2019.resale_path", "text") is None
