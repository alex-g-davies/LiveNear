"""POST /api/cars/recommend (spec 024 R11): shape, reasons, limits, budget."""

from __future__ import annotations

import time

from .test_api_cars import PROFILE

REASONS = {
    "lowest expected cost",
    "narrowest uncertainty band",
    "best fun score",
    "lowest cash up front",
}


def _body(**over):
    body = {"profile": dict(PROFILE), "measure": "per_month", "n": 3, "seed": 3, "draws": 200}
    body.update(over)
    return body


def test_recommend_ranks_the_whole_catalogue_and_tags_reasons(client):
    r = client.post("/api/cars/recommend", json=_body())
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ranking_measure"] == "per_month"
    assert data["n_considered"] >= 10  # 22 variants × allowed modes, minus the ruled out
    rows = data["rows"]
    assert 3 <= len(rows) <= 3 + 3  # top n plus at most one row per extra tag
    assert [row["rank"] for row in rows[:3]] == [1, 2, 3]
    assert "lowest expected cost" in rows[0]["reasons"]
    seen = [reason for row in rows for reason in row["reasons"]]
    assert set(seen) == REASONS and len(seen) == len(REASONS)  # each tag exactly once
    # Rows outside the top n are only there because they hold a tag.
    for row in rows[3:]:
        assert row["rank"] > 3 and row["reasons"]
    # Every row is a full OptionSummary with status and readable estimate labels.
    for row in rows:
        s = row["summary"]
        assert s["result"]["status"] in ("live", "estimate")
        assert len(s["result"]["material_estimate_labels"]) == len(
            s["result"]["material_estimates"]
        )
        assert s["variant_id"] and s["option_kind"] in ("new", "lease", "used_1_3", "used_5_plus")
    # Ranking is by the requested measure.
    ranked = [
        row["summary"]["result"]["measures"]["per_month"]["expected"]["p50"] for row in rows[:3]
    ]
    assert ranked == sorted(ranked)


def test_recommend_respects_limits_and_reports_what_it_ruled_out(client):
    profile = dict(PROFILE)
    profile["limits"] = {"modes": ["used_5_plus"], "must_haves": ["awd"], "max_price_nok": 250000}
    r = client.post("/api/cars/recommend", json=_body(profile=profile, n=5))
    assert r.status_code == 200, r.text
    data = r.json()
    for row in data["rows"]:
        assert row["summary"]["option_kind"] == "used_5_plus"
        assert (
            row["summary"]["result"]["cash_up_front"] <= 250000 * 100 + 1
        )  # cash up front ≤ price
    # Modes are filtered while building (never ranked); must-haves and price are ruled out.
    assert data["ruled_out"].get("not AWD", 0) > 0
    assert data["n_considered"] >= 1


def test_recommend_validates_n_and_draws(client):
    assert client.post("/api/cars/recommend", json=_body(n=0)).status_code == 422
    assert client.post("/api/cars/recommend", json=_body(n=11)).status_code == 422
    assert client.post("/api/cars/recommend", json=_body(draws=5000)).status_code == 422


def test_recommend_full_catalogue_inside_the_two_second_budget(client):
    body = _body(n=10, draws=1000, seed=11)
    t0 = time.perf_counter()
    r = client.post("/api/cars/recommend", json=body)
    elapsed = time.perf_counter() - t0
    assert r.status_code == 200, r.text
    assert elapsed < 2.0, f"recommend took {elapsed:.2f}s"
    # Second call is served from the cache and is identical.
    r2 = client.post("/api/cars/recommend", json=body)
    assert r2.json() == r.json()


def test_recommend_response_carries_no_identifiers(client):
    r = client.post("/api/cars/recommend", json=_body())
    text = r.text.lower()
    assert "finn.no" not in text and "reg_number" not in text


def test_recommend_rows_match_the_full_comparison(client):
    """Recommend ranks with a light pass and builds full results only for the
    rows it returns; those must equal a full run of the whole catalogue."""
    from .test_api_cars import _full_ranges, _req

    rec = client.post("/api/cars/recommend", json=_body(n=5, seed=5, draws=200)).json()
    full = client.post(
        "/api/cars/scenarios",
        json=_req(profile=dict(PROFILE), selection=_full_ranges(client), seed=5, draws=200),
    ).json()
    by_id = {o["result"]["option_id"]: (i + 1, o) for i, o in enumerate(full["options"])}
    assert rec["n_considered"] == len(full["options"])
    assert len(rec["rows"]) >= 5
    for row in rec["rows"]:
        rank, summary = by_id[row["summary"]["result"]["option_id"]]
        assert row["rank"] == rank
        assert row["summary"] == summary
