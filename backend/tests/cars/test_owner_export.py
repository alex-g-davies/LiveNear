"""Owner export -> contract conversion (spec 022 R8). Synthetic rows only."""

from __future__ import annotations

import csv
import io

from app.cars.ingest import owner_export as oe
from app.cars.market import seeds

VEHICLES = seeds.load_vehicles()


def _listing(**over):
    base = {
        "finn_code": "1",
        "url": "https://example.test/item/1",
        "cohort": "M3 RWD 2021-2023",
        "trim_match": "yes",
        "trim_parsed": "RWD",
        "make": "Tesla",
        "model": "Model 3",
        "spec": "Standard Range Plus",
        "model_year": "2022",
        "first_reg": "2022-03-15",
        "mileage_km": "41000",
        "price_nok": "284532",
        "price_excl_rereg": "280000",
        "rereg_fee": "4532",
        "battery_kwh": "60",
        "drivetrain": "RWD",
        "power_hp": "283",
        "seller_type": "dealer",
        "location": "Bergen",
        "sales_form": "sale",
        "published": "2026-10-20",
        "scraped": "2026-10-31",
    }
    base.update(over)
    return base


def test_listing_maps_cohort_and_prices_excluding_rereg():
    conv = oe.convert_listings([_listing()], VEHICLES)
    assert conv.n == 1 and not conv.skipped
    row = conv.rows[0]
    assert row["variant_id"] == "tesla-model3-rwd"
    assert row["asking_price_nok"] == 280000 and row["price_basis"] == "excl_rereg"
    assert row["rereg_fee_nok"] == 4532
    assert row["first_reg_month"] == "2022-03"
    assert row["power_kw_or_hp"] == "283 hp" and row["drive"] == "RWD"
    assert row["snapshot_date"] == "2026-10-31" and row["status"] == "listed"
    assert row["reg_number"] == "" and row["heat_pump"] == "unknown"


def test_listing_falls_back_to_total_price_when_rereg_unknown():
    conv = oe.convert_listings([_listing(price_excl_rereg="", rereg_fee="")], VEHICLES)
    assert conv.rows[0]["asking_price_nok"] == 284532
    assert conv.rows[0]["price_basis"] == "incl_rereg"


def test_listing_skips_are_counted_by_reason():
    rows = [
        _listing(trim_match="no", cohort="M3 other"),
        _listing(trim_match="uncertain"),
        _listing(sales_form="lease"),
        _listing(cohort="Unknown label"),
    ]
    conv = oe.convert_listings(rows, VEHICLES)
    assert conv.n == 0
    assert conv.skipped == {
        "trim_match:no": 1,
        "trim_match:uncertain": 1,
        "sales_form:lease": 1,
        "cohort:unmapped": 1,
    }


def test_listing_csv_round_trips_through_the_contract_columns():
    text = oe.write_csv(oe.convert_listings([_listing()], VEHICLES).rows, oe.LISTING_OUT_COLUMNS)
    back = list(csv.DictReader(io.StringIO(text)))
    assert tuple(back[0].keys()) == oe.LISTING_OUT_COLUMNS
    assert back[0]["ad_id_or_url"] == "https://example.test/item/1"


def _offer(**over):
    base = {
        "offer_id": "42",
        "url": "https://example.test/offer/42",
        "condition": "new",
        "make": "Tesla",
        "model": "Model 3",
        "trim": "Standard RWD",
        "monthly_nok_incl_vat": "2750",
        "term_months": "36",
        "km_per_year": "15000",
        "upfront_nok": "100000",
        "model_year": "2026",
        "scraped": "2026-11-01",
    }
    base.update(over)
    return base


def test_lease_offer_maps_trim_and_flags_unquoted_fees():
    conv = oe.convert_lease_offers([_offer()], VEHICLES)
    assert conv.n == 1
    row = conv.rows[0]
    assert row["variant_id"] == "tesla-model3-rwd-highland"
    assert row["offer_id"] == "lease-42" and row["status"] == "live"
    assert row["monthly_nok"] == 2750 and row["upfront_nok"] == 100000
    assert row["fees_nok_status"] == "estimate" and row["fees_nok_basis"]
    assert row["excess_km_fee_nok_status"] == "estimate"
    assert row["delivery_months"] == 1


def test_lease_facelift_years_go_to_separate_variants():
    old = _offer(model="Model Y", trim="Long Range AWD", model_year="2023", condition="used")
    new = _offer(model="Model Y", trim="Premium Long Range AWD.", model_year="2026")
    conv = oe.convert_lease_offers([old, new], VEHICLES)
    assert [r["variant_id"] for r in conv.rows] == [
        "tesla-modely-lr-awd",
        "tesla-modely-lr-awd-juniper",
    ]
    assert conv.rows[0]["delivery_months"] == 0  # used car in stock


def test_lease_unknown_trim_is_skipped():
    conv = oe.convert_lease_offers([_offer(make="Maserati", model="Grecale")], VEHICLES)
    assert conv.n == 0 and conv.skipped["trim:no_catalogue_variant"] == 1


def test_new_stock_keeps_only_new_condition_as_estimate():
    rows = [
        {
            "condition": "new",
            "make": "MG",
            "model": "MG4",
            "spec": "64 kWh Luxury",
            "model_year": "2026",
            "price_nok": "289900",
            "url": "https://example.test/new/1",
            "scraped": "2026-11-01",
        },
        {
            "condition": "used-near-new",
            "make": "MG",
            "model": "MG4",
            "spec": "64 kWh Luxury",
            "model_year": "2026",
            "price_nok": "279900",
            "url": "https://example.test/new/2",
            "scraped": "2026-11-01",
        },
    ]
    conv = oe.convert_new_stock(rows, VEHICLES)
    assert conv.n == 1 and conv.skipped["condition:used-near-new"] == 1
    assert conv.rows[0]["variant_id"] == "mg-mg4-64"
    assert conv.rows[0]["status"] == "estimate" and "not the manufacturer" in conv.rows[0]["basis"]
    assert oe.near_new_summary(rows) == [("mg-mg4-64", 2026, 1, 279900, 279900)]


def test_lease_seed_loader_honours_per_column_status(tmp_path):
    text = oe.write_csv(oe.convert_lease_offers([_offer()], VEHICLES).rows, oe.LEASE_OUT_COLUMNS)
    path = tmp_path / "lease_quotes.csv"
    path.write_text(text, encoding="utf-8")
    offers = seeds.load_lease_quotes(path)
    assert offers[0].monthly_ore.status == "live"
    assert offers[0].fees_ore.status == "estimate" and offers[0].fees_ore.basis
    assert offers[0].excess_km_fee_ore.value == 150  # 1.50 NOK/km in øre


def test_no_module_in_ingest_knows_the_listing_site():
    # The converter re-shapes owner files; it must not name the site (R8 guard).
    import inspect

    assert "finn.no" not in inspect.getsource(oe)
