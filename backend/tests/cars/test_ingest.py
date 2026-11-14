"""Ingestion core (R8, R12): parsers on stored fixtures, each validation rule
on a failing row, reconciliation, store, R2 client, runner health checks and
the no-FINN guard."""

from __future__ import annotations

import csv
import json
from datetime import date
from pathlib import Path

import httpx
import pytest

from app.cars.data_bundle import FIXTURE_LISTINGS, hash_listing_id
from app.cars.ingest import SourceDisabled
from app.cars.ingest import r2 as r2_mod
from app.cars.ingest.fetch import archive_bytes, ext_for, fetch
from app.cars.ingest.reconcile import dedupe, hash_identity, map_variant, reconcile_listings
from app.cars.ingest.runner import RunConfig, empty_rate_jumps, run, spot_sample
from app.cars.ingest.sources import (
    SOURCE_NAMES,
    load_source,
    norges_bank,
    ssb,
    tesla_configurator,
    vegvesen,
)
from app.cars.ingest.store import Store
from app.cars.ingest.validate import (
    LISTING_RULES,
    ValidationContext,
    field_types,
    km_plausible,
    normalise_listing,
    parse_power_kw,
    price_in_band,
    range_vs_battery,
    required_fields,
    validate_rows,
)
from app.cars.market import seeds

BACKEND = Path(__file__).resolve().parents[2]
INGEST_DIR = BACKEND / "app" / "cars" / "ingest"
FIX = Path(__file__).parent / "fixtures" / "ingest"
TODAY = date(2026, 10, 31)


@pytest.fixture(scope="module")
def vehicles():
    return seeds.load_vehicles()


def _row(**over):
    base = {
        "snapshot_date": "2026-10-24",
        "ad_id_or_url": "fx-1",
        "make": "Tesla",
        "model": "Model 3",
        "trim_as_listed": "RWD",
        "model_year": "2022",
        "first_reg_month": "2022-03",
        "battery_kwh": "60",
        "drive": "RWD",
        "power_kw_or_hp": "208 kW",
        "km": "45 000",
        "asking_price_nok": "259 900",
        "seller_type": "private",
        "location": "Oslo",
        "ex_fleet_or_taxi": "n",
        "warranty_note": "",
        "heat_pump": "y",
        "reg_number": "",
        "status": "listed",
    }
    base.update(over)
    return normalise_listing(base)


# --------------------------------------------------------------- no FINN adapter


def test_no_module_under_ingest_references_finn():
    needle = "finn" + ".no"
    hits = [p for p in INGEST_DIR.rglob("*.py") if needle in p.read_text(encoding="utf-8").lower()]
    assert hits == []
    assert not any("finn" in name for name in SOURCE_NAMES)


# --------------------------------------------------------------- validation rules


def test_units_normalised():
    r = _row()
    assert r["ask_ore"] == 259_900_00 and r["km"] == 45_000 and r["power_kw"] == 208
    assert parse_power_kw("204 hp") == 150 and parse_power_kw("150") == 150
    assert parse_power_kw("283 hk") == 208 and parse_power_kw("n/a") is None


def test_each_rule_fails_on_a_bad_row(vehicles):
    ctx = ValidationContext(as_of=TODAY, prior_value=lambda v, y, km: 250_000_00)
    assert required_fields(_row(asking_price_nok=""), ctx) == ["missing:asking_price_nok"]
    assert "type:snapshot_date" in field_types(_row(snapshot_date="24/10/2026"), ctx)
    assert "type:model_year" in field_types(_row(model_year="twenty"), ctx)
    assert "enum:seller_type" in field_types(_row(seller_type="auction"), ctx)
    assert "enum:status" in field_types(_row(status="sold"), ctx)
    assert "enum:drive" in field_types(_row(drive="4x4"), ctx)
    assert price_in_band(_row(variant_id="tesla-model3-rwd", asking_price_nok="20 000"), ctx)
    assert price_in_band(_row(variant_id="tesla-model3-rwd", asking_price_nok="1 500 000"), ctx)
    assert price_in_band(_row(variant_id="tesla-model3-rwd"), ctx) == []
    assert price_in_band(_row(), ctx) == []  # no variant => no prior => no check
    assert km_plausible(_row(model_year="2026", km="90 000"), ctx)
    assert km_plausible(_row(model_year="2019", km="300 000"), ctx) == []
    assert range_vs_battery(_row(range_km_wltp="1200"), ctx)
    assert range_vs_battery(_row(range_km_wltp="480"), ctx) == []
    ok, bad = validate_rows([_row(), _row(km="-5")], LISTING_RULES, ctx)
    assert len(ok) == 1 and bad[0].failed_checks == ["type:km"]
    assert "reg_number" not in bad[0].raw_excerpt


# --------------------------------------------------------------- reconcile


def test_map_variant_by_trim_then_by_buckets(vehicles):
    assert map_variant(_row(), vehicles) == "tesla-model3-rwd"
    assert (
        map_variant(_row(trim_as_listed="Long Range AWD", drive="AWD"), vehicles)
        == "tesla-model3-lr-awd"
    )
    # unknown trim text: two RWD 60 kWh Model 3 variants share the buckets, but the
    # 2022 model year rules out the Highland (2024-); without a year it stays unmapped.
    assert map_variant(_row(trim_as_listed="Standard Plus"), vehicles) == "tesla-model3-rwd"
    assert map_variant(_row(trim_as_listed="Standard Plus", model_year=""), vehicles) is None
    # Model Y: AWD 75 kWh and a 2022 model year => the 2022-2024 variant, not the facelift
    assert (
        map_variant(
            _row(
                model="Model Y",
                trim_as_listed="?",
                battery_kwh="75",
                drive="AWD",
                power_kw_or_hp="258 kW",
            ),
            vehicles,
        )
        == "tesla-modely-lr-awd"
    )
    assert map_variant(_row(make="Nissan", model="Leaf"), vehicles) is None


def test_reconcile_hashes_and_drops_reg_numbers(vehicles):
    rows = [
        _row(reg_number="EL12345"),
        _row(reg_number="EL12345"),
        _row(ad_id_or_url="x", make="Nissan"),
    ]
    ok, bad = reconcile_listings(rows, vehicles, salt="s")
    assert len(ok) == 1 and len(bad) == 1  # duplicate (listing, snapshot) collapsed
    assert "reg_number" not in ok[0] and "reg_number" not in bad[0].row
    assert ok[0]["listing_id"] == hash_listing_id("fx-1", "EL12345", salt="s")
    assert (
        hash_identity({"ad_id_or_url": "a", "reg_number": "B"}, salt="s")["listing_id"]
        != hash_identity({"ad_id_or_url": "a"}, salt="s")["listing_id"]
    )
    assert (
        len(
            dedupe(
                [
                    {"listing_id": "1", "snapshot_date": "d"},
                    {"listing_id": "1", "snapshot_date": "d"},
                ]
            )
        )
        == 1
    )


# --------------------------------------------------------------- fetch + store + r2


def test_fetch_archives_body_with_sha_and_user_agent(tmp_path, httpx_mock):
    httpx_mock.add_response(
        url="https://example.org/data.json",
        json={"a": 1},
        headers={"content-type": "application/json"},
    )
    snap = fetch("https://example.org/data.json", "test_src", tmp_path / "raw")
    req = httpx_mock.get_request()
    assert req.headers["user-agent"].startswith("LiveNear-cars/0.1")
    assert snap.path.exists() and snap.path.suffix == ".json" and len(snap.sha256) == 64
    assert (
        snap.path.parent.name == snap.fetched_at.date().isoformat()
        and snap.path.parent.parent.name == "test_src"
    )
    meta = json.loads(snap.path.with_suffix(".json.meta.json").read_text())
    assert meta["url"] == "https://example.org/data.json" and meta["sha256"] == snap.sha256
    assert (
        ext_for(None, "https://x/y.csv") == "csv"
        and ext_for("text/html; charset=utf-8", "https://x/") == "html"
    )
    httpx_mock.add_response(url="https://example.org/404", status_code=404)
    with pytest.raises(httpx.HTTPStatusError):
        fetch("https://example.org/404", "test_src", tmp_path / "raw")


class FakeS3:
    def __init__(self):
        self.objects: dict[str, bytes] = {}
        self.uploaded: list[tuple[str, str]] = []

    def upload_file(self, path, bucket, key):
        self.uploaded.append((bucket, key))
        self.objects[key] = Path(path).read_bytes()

    def put_object(self, Bucket, Key, Body, ContentType):
        self.objects[Key] = Body

    def get_object(self, Bucket, Key):
        import io

        return {"Body": io.BytesIO(self.objects[Key])}


def test_r2_helpers_use_injected_client(monkeypatch, tmp_path):
    env = {
        "CARS_R2_ACCOUNT_ID": "acc",
        "CARS_R2_ACCESS_KEY_ID": "k",
        "CARS_R2_SECRET_ACCESS_KEY": "s",
        "CARS_R2_BUCKET": "cars-private",
    }
    assert not r2_mod.configured({})
    assert r2_mod.configured(env)
    assert r2_mod.endpoint_url("acc") == "https://acc.r2.cloudflarestorage.com"
    with pytest.raises(RuntimeError, match="not configured"):
        r2_mod._client({})
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    fake = FakeS3()
    monkeypatch.setattr(r2_mod, "_client", lambda env=None: fake)
    r2_mod.upload_text("a,b\n1,2\n", "listings/listings.csv")
    assert r2_mod.download_text("listings/listings.csv") == "a,b\n1,2\n"
    snap = archive_bytes(
        b"x",
        source="s",
        raw_dir=tmp_path,
        url="file:///x",
        fetched_at=__import__("datetime").datetime(
            2026, 10, 31, 0, 0, tzinfo=__import__("datetime").UTC
        ),
        ext="txt",
        r2_upload=True,
        r2_client=fake,
    )
    assert fake.uploaded == [("cars-private", f"raw/s/2026-10-31/{snap.sha256[:12]}.txt")]


def test_store_refuses_identifier_columns_and_consolidates(tmp_path):
    store = Store(tmp_path)
    with pytest.raises(ValueError):
        store.write_source("x", TODAY, [{"listing_id": "1", "reg_number": "EL1"}])
    rows = [
        {"listing_id": "1", "snapshot_date": "2026-10-24", "ask_ore": 1, "snapshot_sha256": "abc"}
    ]
    store.consolidate("listings", rows)
    store.consolidate(
        "listings", [{**rows[0], "ask_ore": 2}, {**rows[0], "snapshot_date": "2026-10-31"}]
    )
    data = list(csv.DictReader((tmp_path / "store" / "listings.csv").open(encoding="utf-8")))
    assert len(data) == 2 and data[0]["ask_ore"] == "2"


# --------------------------------------------------------------- source parsers on fixtures


def test_norges_bank_parser_and_heuristic():
    doc = json.loads((FIX / "norges_bank_kpra.json").read_text(encoding="utf-8"))
    d, rate = norges_bank.parse_policy_rate(doc)
    assert d == date(2026, 10, 29) and str(rate) == "4.25"
    patch = norges_bank.to_rates_patch(d, rate)
    assert patch["policy_rate_pct"].status == "live"
    loan = patch["car_loan_rate_pct"]
    assert loan.status == "estimate" and "Heuristic" in (loan.basis or "")
    assert (
        str(loan.value) == "6.75" and loan.range and loan.range.low < loan.value < loan.range.high
    )


def test_ssb_parsers():
    cpi = ssb.cpi_record(json.loads((FIX / "ssb_cpi_03013.json").read_text(encoding="utf-8")))
    assert cpi["period"] == "2026M09" and cpi["value"] == "137.9" and cpi["table"] == "03013"
    el = ssb.electricity_record(
        json.loads((FIX / "ssb_electricity_09387.json").read_text(encoding="utf-8"))
    )
    assert (
        el["period"] == "2026K3" and el["value"] == "148.6" and el["series"] == "home_ore_per_kwh"
    )


def test_vegvesen_parser_cache_and_disabled_without_key(tmp_path, httpx_mock):
    doc = json.loads((FIX / "vegvesen_kjoretoydata.json").read_text(encoding="utf-8"))
    facts = vegvesen.parse_kjoretoydata(doc)
    assert facts == vegvesen.VehicleFacts("2021-08-17", 208, "Elektrisk", 1752)
    assert vegvesen.parse_kjoretoydata({"kjoretoydataListe": []}) is None
    httpx_mock.add_response(url=f"{vegvesen.URL}?kjennemerke=EL12345", json=doc)
    f1, cached1, sha1 = vegvesen.lookup("el 12345", "KEY", tmp_path / "cache", tmp_path / "raw")
    f2, cached2, sha2 = vegvesen.lookup("EL12345", "KEY", tmp_path / "cache", tmp_path / "raw")
    assert f1 == f2 == facts and not cached1 and cached2 and sha1 == sha2
    req = httpx_mock.get_request()
    assert req.headers["svv-authorization"] == "Apikey KEY"
    cache_files = list((tmp_path / "cache" / "vegvesen").glob("*.json"))
    assert len(cache_files) == 1 and "EL12345" not in cache_files[0].name
    assert "EL12345" not in cache_files[0].name.upper()
    from app.cars.ingest.sources import SourceContext

    ctx = SourceContext(
        today=TODAY, out_dir=tmp_path, raw_dir=tmp_path / "raw", vehicles=[], env={}
    )
    with pytest.raises(SourceDisabled):
        vegvesen.make_enricher(ctx)
    with pytest.raises(SourceDisabled):
        vegvesen.run_source(ctx)


def test_tesla_parser_on_fixture_and_gate():
    html = (FIX / "tesla_model3_design.html").read_text(encoding="utf-8")
    trims = tesla_configurator.parse_configurator_html(html)
    names = {t.name: t.price_ore for t in trims}
    assert names["Model 3 Bakhjulsdrift"] == 389_900_00
    assert names["Model 3 Performance"] == 549_900_00
    assert "Pearl White Multi-Coat" not in names and len(trims) == 4
    with pytest.raises(SourceDisabled, match="terms check pending"):
        tesla_configurator.guard({})
    with pytest.raises(SourceDisabled, match="web container"):
        tesla_configurator.guard({"CARS_ALLOW_TESLA_SCRAPE": "1", "STATIC_DIR": "/srv/static"})
    tesla_configurator.guard({"CARS_ALLOW_TESLA_SCRAPE": "1"})  # allowed on a laptop/CI only
    assert load_source("tesla_configurator") is tesla_configurator


# --------------------------------------------------------------- runner


def _write_listings(tmp_path: Path, extra_rows: list[dict] | None = None) -> Path:
    text = FIXTURE_LISTINGS.read_text(encoding="utf-8")
    lines = text.splitlines()
    header = lines[0].split(",")
    keep = lines[: 1 + 400]
    for r in extra_rows or []:
        keep.append(",".join(r.get(h, "") for h in header))
    path = tmp_path / "listings.csv"
    path.write_text("\n".join(keep) + "\n", encoding="utf-8")
    return path


def test_runner_stores_validated_rows_and_quarantines_failures(tmp_path, httpx_mock):
    bad = [
        {
            "snapshot_date": "2026-10-31",
            "ad_id_or_url": "bad-1",
            "make": "Tesla",
            "model": "Model 3",
            "trim_as_listed": "RWD",
            "model_year": "2022",
            "km": "-1",
            "asking_price_nok": "250000",
            "seller_type": "private",
            "status": "listed",
        },
        {
            "snapshot_date": "2026-10-31",
            "ad_id_or_url": "bad-2",
            "make": "Nissan",
            "model": "Leaf",
            "trim_as_listed": "e+",
            "model_year": "2020",
            "km": "50000",
            "asking_price_nok": "150000",
            "seller_type": "private",
            "status": "listed",
        },
        {
            "snapshot_date": "2026-10-31",
            "ad_id_or_url": "bad-3",
            "make": "Tesla",
            "model": "Model 3",
            "trim_as_listed": "RWD",
            "model_year": "2022",
            "km": "40000",
            "asking_price_nok": "9 000 000",
            "seller_type": "dealer",
            "status": "listed",
            "reg_number": "EL99999",
        },
    ]
    listings = _write_listings(tmp_path, bad)
    httpx_mock.add_response(
        url=norges_bank.URL, json=json.loads((FIX / "norges_bank_kpra.json").read_text())
    )
    httpx_mock.add_response(
        url=ssb.CPI_URL, method="POST", json=json.loads((FIX / "ssb_cpi_03013.json").read_text())
    )
    httpx_mock.add_response(
        url=ssb.ELECTRICITY_URL,
        method="POST",
        json=json.loads((FIX / "ssb_electricity_09387.json").read_text()),
    )
    cfg = RunConfig(
        sources=[
            "listings_csv",
            "new_prices_csv",
            "lease_csv",
            "norges_bank",
            "ssb",
            "vegvesen",
            "tesla_configurator",
        ],
        out_dir=tmp_path / "out",
        raw_dir=tmp_path / "raw",
        listings_path=listings,
        new_prices_path=seeds.SEED_DIR / "new_prices.csv",
        lease_path=seeds.SEED_DIR / "lease_quotes.csv",
        today=TODAY,
        env={},
    )
    report = run(cfg)
    by = {s.source: s for s in report.sources}
    assert by["listings_csv"].rows_in == 403 and by["listings_csv"].quarantined == 3
    assert by["listings_csv"].stored == 400
    assert by["new_prices_csv"].stored == len(seeds.load_new_prices())
    assert by["lease_csv"].stored == len(seeds.load_lease_quotes())
    assert by["norges_bank"].stored == 1 and by["ssb"].stored == 2
    assert by["vegvesen"].status == "disabled" and by["tesla_configurator"].status == "disabled"
    assert "terms check pending" in by["tesla_configurator"].note
    assert report.ok, report.failures
    out = tmp_path / "out"
    q = list(
        csv.DictReader((out / "quarantine" / "listings_csv-2026-10-31.csv").open(encoding="utf-8"))
    )
    checks = {r["ad_id_or_url"]: r["failed_checks"] for r in q}
    assert checks["bad-1"] == "type:km" and checks["bad-2"] == "reconcile:unknown_variant"
    assert "range:price_vs_prior" in checks["bad-3"]
    assert (
        "reg_number" not in q[0]
        and "EL99999" not in (out / "quarantine" / "listings_csv-2026-10-31.csv").read_text()
    )
    stored = list(csv.DictReader((out / "store" / "listings.csv").open(encoding="utf-8")))
    assert len(stored) == 400 and all(len(r["snapshot_sha256"]) == 64 for r in stored)
    assert "reg_number" not in stored[0] and stored[0]["ask_ore"].isdigit()
    assert (out / "store" / "listings_csv" / "2026-10-31.csv").exists()
    assert (out / "store" / "new_prices.csv").exists() and (
        out / "store" / "lease_quotes.csv"
    ).exists()
    spot = list(csv.DictReader((out / "quarantine" / "spot_check.csv").open(encoding="utf-8")))
    # 2 % of every row stored by the run, across all sources.
    assert len(spot) == round(0.02 * sum(src.stored for src in report.sources))
    rep = json.loads((out / "run_report.json").read_text())
    assert rep["ok"] and rep["sources"][0]["source"] == "listings_csv"
    raw_dir = tmp_path / "raw" / "norges_bank" / "2026-10-31"
    raw_files = [p for p in raw_dir.glob("*.json") if not p.name.endswith(".meta.json")]
    assert len(raw_files) == 1 and raw_files[0].with_suffix(".json.meta.json").exists()
    assert report.table().startswith("source")


def test_runner_fails_loudly_on_empty_source_and_empty_rate_jump(tmp_path, caplog):
    empty = tmp_path / "empty.csv"
    empty.write_text(
        "snapshot_date,ad_id_or_url,make,model,trim_as_listed,model_year,km,asking_price_nok\n",
        encoding="utf-8",
    )
    cfg = RunConfig(
        sources=["listings_csv"],
        out_dir=tmp_path / "out",
        raw_dir=tmp_path / "raw",
        listings_path=empty,
        today=TODAY,
        env={},
    )
    report = run(cfg)
    assert not report.ok and "zero rows" in report.failures[0]
    assert any("HEALTH CHECK FAILED" in r.message for r in caplog.records)
    from app.cars.ingest.runner import SourceReport

    prev = SourceReport("listings_csv", stored=100, empty_rates={"first_reg_month": 0.05})
    cur = SourceReport(
        "listings_csv", stored=100, empty_rates={"first_reg_month": 0.40, "location": 0.0}
    )
    assert empty_rate_jumps(cur, prev) and "first_reg_month" in empty_rate_jumps(cur, prev)[0]
    assert empty_rate_jumps(SourceReport("x", stored=0), prev) == []
    assert spot_sample([{"a": i} for i in range(100)]) == spot_sample(
        [{"a": i} for i in range(100)]
    )
    assert len(spot_sample([{"a": i} for i in range(100)])) == 2
    assert run(
        RunConfig(
            sources=["nope"], out_dir=tmp_path / "o2", raw_dir=tmp_path / "r2", today=TODAY, env={}
        )
    ).failures


def test_runner_cli_help_lists_sources(capsys):
    from app.cars.ingest.runner import main

    with pytest.raises(SystemExit) as exc:
        main(["--help"])
    assert exc.value.code == 0
    assert "tesla_configurator" in capsys.readouterr().out
