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


def _target_listing(**over):
    """Second export shape (2026-11-02): `target_variant` label, `sale_form`
    column, no `cohort` / `trim_match`."""
    base = {
        "finn_code": "2",
        "url": "https://example.test/item/2",
        "make": "Nissan",
        "model": "Leaf",
        "spec": "40kWh Acenta",
        "condition": "used",
        "model_year": "2019",
        "first_reg": "2019-05-02",
        "mileage_km": "83000",
        "price_nok": "134532",
        "price_excl_rereg": "130000",
        "rereg_fee": "4532",
        "battery_kwh": "40",
        "drivetrain": "FWD",
        "power_hp": "150",
        "seller_type": "private",
        "location": "Oslo",
        "published": "2026-10-18",
        "scraped": "2026-11-02",
        "target_variant": "Leaf 40 kWh",
        "owners": "1",
        "dealer_segment": "Privat",
        "last_updated": "2026-10-18",
        "sale_form": "",
    }
    base.update(over)
    return base


def test_target_variant_export_maps_without_a_trim_match_column():
    conv = oe.convert_listings([_target_listing()], VEHICLES)
    assert conv.n == 1 and not conv.skipped
    row = conv.rows[0]
    assert row["variant_id"] == "nissan-leaf-40"
    assert row["make"] == "Nissan" and row["model"] == "Leaf"
    assert row["asking_price_nok"] == 130000 and row["price_basis"] == "excl_rereg"
    assert row["snapshot_date"] == "2026-11-02" and row["seller_type"] == "private"


def test_target_variant_export_skips_lease_takeovers_auctions_and_unknown_labels():
    rows = [
        _target_listing(sale_form="Leasing"),
        _target_listing(sale_form="Auksjon"),
        _target_listing(target_variant="Not a label"),
        _target_listing(target_variant="Zoe ZE50 52 kWh (R110)", make="Renault", model="Zoe"),
    ]
    conv = oe.convert_listings(rows, VEHICLES)
    assert conv.n == 1 and conv.rows[0]["variant_id"] == "renault-zoe-ze50"
    assert conv.skipped == {"sales_form:leasing": 1, "sales_form:auksjon": 1, "cohort:unmapped": 1}


def test_both_export_shapes_convert_in_one_run():
    conv = oe.convert_listings([_listing(), _target_listing()], VEHICLES)
    assert [r["variant_id"] for r in conv.rows] == ["tesla-model3-rwd", "nissan-leaf-40"]


def _model_listing(target: str, spec: str, year: int = 2023, **over):
    """Third export shape (2026-11-12): model-level label, trim only in `spec`,
    no drivetrain or power columns."""
    return _target_listing(
        target_variant=target,
        spec=spec,
        model_year=str(year),
        drivetrain="",
        power_hp="",
        first_reg="",
        **over,
    )


def test_model_level_export_reads_the_variant_from_the_spec_text():
    cases = [
        ("Tesla Model Y", "533KM - Long Range AWD Hengerfeste", 2023, "tesla-modely-lr-awd"),
        ("Tesla Model Y", "AWD 533km Berlin/ AMD Ryzen", 2022, "tesla-modely-lr-awd"),
        ("Tesla Model Y", "Standard Range RWD", 2024, "tesla-modely-rwd"),
        ("VW ID.4", "PRO LIMITED 77KWH 204HK / KROK", 2023, "vw-id4-pro-rwd"),
        ("Skoda Enyaq", "iV80 Sportline", 2022, "skoda-enyaq-80-rwd"),
        ("Hyundai Ioniq 5", "LR RWD Premium", 2022, "hyundai-ioniq5-lr-rwd"),
        ("Volvo XC40 Recharge", "Recharge 231hk FWD Core", 2022, "volvo-xc40-sm-69"),
        ("Volvo XC40 Recharge", "Extended Range Ultimate", 2024, "volvo-xc40-sm-er-82"),
        ("Kia EV6", "Active 77 kWh RWD", 2023, "kia-ev6-lr-rwd"),
    ]
    for target, spec, year, want in cases:
        assert oe.match_spec(target, spec, year) == want, (target, spec)


def test_model_level_export_never_guesses_other_trims_or_years():
    cases = [
        ("Tesla Model Y", "Performance AWD 534HK", 2023),
        ("Tesla Model Y", "Long Range AWD (507km)", 2021),  # not a catalogue year
        ("Tesla Model Y", "Long Range RWD", 2024),  # a different variant
        ("VW ID.4", "GTX 4MOTION 77KWH", 2022),
        ("VW ID.4", "Pro 77kWh 174hk", 2022),  # lower-power Pro
        ("VW ID.4", "Hengerfeste Ryggekamera ACC", 2023),  # trim not stated
        ("Skoda Enyaq", "iV 80x Sportline", 2023),
        ("Skoda Enyaq", "iV60 Lounge", 2023),
        ("Hyundai Ioniq 5", "LR AWD Premium", 2022),
        ("Hyundai Ioniq 5", "Premium 2WD", 2022),  # battery not stated
        ("Volvo XC40 Recharge", "Recharge Twin 408hk AWD", 2023),
        ("Kia EV6", "GT-Line AWD", 2022),
    ]
    for target, spec, year in cases:
        assert oe.match_spec(target, spec, year) is None, (target, spec, year)


def test_model_level_export_fills_drive_and_power_from_the_variant():
    rows = [
        _model_listing("Kia EV6", "Exclusive 77 kWh RWD", make="Kia", model="EV6"),
        _model_listing("Kia EV6", "GT-Line AWD", make="Kia", model="EV6"),
    ]
    conv = oe.convert_listings(rows, VEHICLES)
    assert conv.n == 1 and conv.skipped == {"spec:unmatched:Kia EV6": 1}
    row = conv.rows[0]
    assert row["variant_id"] == "kia-ev6-lr-rwd"
    assert row["drive"] == "RWD" and row["power_kw_or_hp"].endswith(" kW")
    assert row["first_reg_month"] == ""


def test_lease_id3_pro_58_maps_to_the_performance_variant():
    assert oe.match_trim("Volkswagen", "ID.3", "ID.3 Pro Limited 58KWH", 2023) == (
        "vw-id3-pro-performance-58"
    )
    assert oe.match_trim("Volkswagen", "ID.3", "ID.3 Pro Limited 58KWH", 2024) is None


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
