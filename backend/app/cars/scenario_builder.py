"""Turn a browser profile + market selection into an engine Scenario (R10, R11).

For every selected variant × model year the builder emits up to four options
(one per way to get the car the user allows) using the bundle:

- new:        latest list price for the newest model year, loan from the
              rates record, resale path from the market model at age 0;
- lease:      each lease offer on file for the variant (skipped with a note
              when none exists);
- used_1_3:   the cohort if the car is 12–47 months old on the start date,
              bought from a dealer at the cohort value plus the dealer margin;
- used_5_plus: the cohort if the car is 60+ months old, bought privately.

Cars aged 48–59 months fall in neither used band and are skipped with a note.
Every value carries provenance from the bundle; defaults are estimates.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date
from decimal import Decimal

from .bundle_schema import LeaseOfferRecord, VariantRecord
from .data_bundle import Bundle
from .engine.defaults import default_insurance
from .engine.models import (
    BuyNew,
    ChargingMix,
    ChargingPrices,
    DefaultEarlyExit,
    ExitOdds,
    FixedTable,
    FuelPrices,
    In,
    InsuranceDefault,
    InsuranceProfile,
    Lease,
    Limits,
    Loan,
    MarketPolicyInputs,
    Option,
    PercentOfRemaining,
    RepairAllowance,
    Scenario,
    TaxRuleSet,
    Used,
    UserInputs,
    VehicleInputs,
)
from .engine.money import mul, nok, pct
from .market.predict import anchor_value, value_path
from .rules import toll_ring_for
from .schemas import Profile, SelectionItem

MID_YEAR_MONTH = 7
NBSP = " "  # thousands separator in display text


def age_months_on(start: date, model_year: int) -> int:
    """Whole months from the model year's midpoint (1 July) to `start`."""
    return max(0, (start.year - model_year) * 12 + (start.month - MID_YEAR_MONTH))


def _vehicle_inputs(v: VariantRecord, model_year: int) -> VehicleInputs:
    return VehicleInputs(
        variant_id=v.variant_id,
        make=v.make,
        model=v.model,
        trim_group=v.trim_group,
        model_year=model_year,
        energy_type=v.energy_type,
        drive=v.drive,
        body=v.body,
        battery_kwh=v.battery_kwh,
        power_kw=v.power_kw,
        heat_pump=v.heat_pump,
        auto_precondition=v.auto_precondition,
        tyre_size=v.tyre_size,
        weight_kg=v.weight_kg,
        fuel=v.fuel,
        efficiency_wh_per_km=v.efficiency_wh_per_km,
        fuel_l_per_100km=v.fuel_l_per_100km,
        winter_factor=v.winter_factor,
        tyre_set_ore=v.tyre_set_ore,
        tyre_life_km=v.tyre_life_km,
        service_interval_months=v.service_interval_months,
        service_interval_km=v.service_interval_km,
        service_first_months=v.service_first_months,
        service_price_ore=v.service_price_ore,
        service_first_price_ore=v.service_first_price_ore,
        service_price_after_7y_ore=v.service_price_after_7y_ore,
        wear_per_year_ore=v.wear_per_year_ore,
        warranty_years=v.warranty_years,
        warranty_km=v.warranty_km,
        fun_score=v.fun_score,
        new_price_ore=None,
    )


def _loan(b: Bundle, prefix: str) -> Loan:
    r = b.rates
    return Loan(
        annual_rate_pct=r.car_loan_rate_pct.model_copy(update={"id": f"{prefix}.loan_rate"}),
        term_months=60,
        establishment_fee_ore=r.loan_establishment_fee_ore.model_copy(
            update={"id": f"{prefix}.loan_establishment_fee"}
        ),
        monthly_fee_ore=r.loan_monthly_fee_ore.model_copy(
            update={"id": f"{prefix}.loan_monthly_fee"}
        ),
    )


def _insurance(
    b: Bundle, profile: Profile, variant_id: str, price_ore: int, prefix: str
) -> InsuranceDefault:
    quote = profile.insurance_quotes_nok.get(variant_id)
    if quote:
        return InsuranceDefault(
            annual_ore=In[int](
                id=f"{prefix}.insurance_annual",
                value=nok(quote),
                source="Your insurance quote",
                as_of=profile.start_date or b.meta.bundle_as_of,
                status="live",
            )
        )
    prof = InsuranceProfile(
        age_band=profile.insurance.age_band,
        claims_free_years=profile.insurance.claims_free_years,
        has_claims_free_letter=profile.insurance.has_claims_free_letter,
    )
    return InsuranceDefault(annual_ore=default_insurance(prof, price_ore, prefix))


def _early_exit(o: LeaseOfferRecord):
    ee = o.early_exit
    if ee.kind == "percent_of_remaining" and ee.percent is not None:
        return PercentOfRemaining(percent=ee.percent)
    if ee.kind == "fixed_table" and ee.by_month_ore:
        return FixedTable(
            by_month=ee.by_month_ore,
            source=In[str](
                id=f"{o.offer_id}.early_exit_table",
                value="contract table",
                source=o.source,
                as_of=o.as_of,
                status=o.status,
                basis=None if o.status == "live" else "lease quote marked estimate",
            ),
        )
    assert ee.recovery_pct is not None
    return DefaultEarlyExit(recovery_pct=ee.recovery_pct)


def group_selection(selection: Iterable[SelectionItem]) -> list[tuple[str, list[tuple[int, int]]]]:
    """One entry per variant, in first-seen order, with every year range asked for.

    The Market map and the recommendation strip add single model years, so a
    variant can arrive as several items (2019 and 2021 but not 2020). Building
    per item would add its lease offers and buy-new option once per item under
    the same option id; grouping keeps one option per (variant, year, kind).
    """
    out: dict[str, list[tuple[int, int]]] = {}
    for sel in selection:
        out.setdefault(sel.variant_id, []).append((sel.year_from, sel.year_to))
    return list(out.items())


def build_scenario(
    b: Bundle,
    profile: Profile,
    selection: list[SelectionItem],
    rules: TaxRuleSet,
    start: date,
    seed: int = 0,
    draws: int = 2000,
) -> tuple[Scenario, list[str], dict[str, dict]]:
    """Returns the scenario, notes for selections that produced no option, and
    per-option metadata (variant_id, kind, seller, lease offer id)."""
    user = UserInputs(
        exit_odds=ExitOdds(**profile.exit_odds.model_dump()),
        km_per_year=profile.km_per_year,
        charging_mix=ChargingMix(**profile.charging_mix.model_dump()),
        municipality=profile.municipality,
        toll_passages_per_week=profile.toll_passages_per_week,
        pay_mode="cash" if profile.pay_mode == "cash" else "loan",
        return_on_cash_pct=profile.return_on_cash_pct,
        down_payment_ore=nok(profile.down_payment_nok),
        insurance=InsuranceProfile(**profile.insurance.model_dump()),
        limits=Limits(
            max_price_ore=nok(profile.limits.max_price_nok)
            if profile.limits.max_price_nok
            else None,
            need_by=profile.limits.need_by,
            must_haves=tuple(profile.limits.must_haves),
            modes=tuple(profile.limits.modes),
        ),
        fun_weight=profile.fun_weight,
        start_date=start,
    )
    r = b.rates
    market = MarketPolicyInputs(
        tax_rules=rules,
        charging=ChargingPrices(
            home_ore_per_kwh=r.home_ore_per_kwh, public_ore_per_kwh=r.public_ore_per_kwh
        ),
        used_price_drift=b.market.used_price_drift,
        rental_per_month_ore=r.rental_per_month_ore,
        materiality_threshold=r.materiality_threshold,
        repair=RepairAllowance(
            bands=r.repair_bands,
            source=r.repair_source,
            ev_factor=r.repair_ev_factor,
            in_warranty_factor=r.repair_in_warranty_factor,
        ),
        inspection_fee_ore=r.inspection_fee_ore,
        wheel_change_ore=r.wheel_change_ore,
        toll_ring=toll_ring_for(profile.municipality),
        fuel_prices=FuelPrices(
            petrol_ore_per_litre=r.petrol_ore_per_litre,
            diesel_ore_per_litre=r.diesel_ore_per_litre,
        )
        if r.petrol_ore_per_litre and r.diesel_ore_per_litre
        else None,
    )
    options: list[Option] = []
    notes: list[str] = []
    meta: dict[str, dict] = {}
    allowed = set(profile.limits.modes)
    for variant_id, ranges in group_selection(selection):
        try:
            v = b.vehicle(variant_id)
        except KeyError:
            notes.append(f"{variant_id}: unknown variant")
            continue
        years = [y for y in v.model_years if any(lo <= y <= hi for lo, hi in ranges)]
        if not years:
            lo, hi = min(r[0] for r in ranges), max(r[1] for r in ranges)
            notes.append(f"{v.make} {v.model} {v.trim_group}: no model years in {lo}–{hi}")
            continue
        label_base = f"{v.make} {v.model} {v.trim_group}"
        newest = max(v.model_years)

        # --- buy new (only the newest model year on the price list, and only
        # while that year is current: a variant whose last model year is two
        # or more years before the start is no longer sold new) -------------
        if "new" in allowed and newest in years and newest < start.year - 1:
            notes.append(f"{label_base}: last model year {newest}, not sold new in {start.year}")
        elif "new" in allowed and newest in years:
            price = b.new_price(v.variant_id, newest)
            if price is None:
                notes.append(f"{label_base} {newest}: no new price on file")
            else:
                oid = f"{v.variant_id}:{newest}:new"
                deal = BuyNew(
                    price_ore=price.price_ore.model_copy(update={"id": f"{oid}.price"}),
                    fees_ore=r.new_car_fees_ore.model_copy(update={"id": f"{oid}.fees"}),
                    delivery_months=r.new_car_delivery_months.model_copy(
                        update={"id": f"{oid}.delivery_months"}
                    ),
                    registered_on=start,
                    loan=_loan(b, oid),
                    exit_friction_pct=r.dealer_exit_friction_pct.model_copy(
                        update={"id": f"{oid}.exit_friction_pct"}
                    ),
                )
                resale = value_path(
                    b.market,
                    v.variant_id,
                    newest,
                    0,
                    0,
                    profile.km_per_year,
                    anchor_ore=price.price_ore.value,
                    as_of=b.meta.bundle_as_of,
                )
                options.append(
                    Option(
                        id=oid,
                        label=f"{label_base} {newest}, buy new",
                        vehicle=_vehicle_inputs(v, newest),
                        deal=deal,
                        insurance=_insurance(b, profile, v.variant_id, price.price_ore.value, oid),
                        resale=resale,
                    )
                )
                meta[oid] = {
                    "variant_id": v.variant_id,
                    "kind": "new",
                    "seller": "dealer",
                    "offer": None,
                }

        # --- lease: every offer on file for this variant ----------------------
        if "lease" in allowed:
            offers = b.lease_offers_for(v.variant_id)
            if not offers:
                notes.append(f"{label_base}: no lease offer on file")
            for o in offers:
                oid = f"{v.variant_id}:{o.model_year}:lease:{o.offer_id}"
                deal = Lease(
                    term_months=o.term_months,
                    monthly_ore=o.monthly_ore,
                    upfront_ore=o.upfront_ore,
                    fees_ore=o.fees_ore,
                    km_cap_per_year=o.km_cap_per_year,
                    excess_km_fee_ore=o.excess_km_fee_ore,
                    includes=o.includes,
                    early_exit=_early_exit(o),
                    end_of_lease_fee_ore=o.end_of_lease_fee_ore,
                    delivery_months=o.delivery_months,
                    age_months_at_start=(
                        age_months_on(start, o.model_year)
                        if getattr(o, "condition", "new") == "used"
                        else 0
                    ),
                )
                np_ = b.new_price(v.variant_id, o.model_year)
                basis_price = np_.price_ore.value if np_ else nok(400_000)
                options.append(
                    Option(
                        id=oid,
                        label=f"{label_base} {o.model_year}, {o.term_months}-month lease",
                        vehicle=_vehicle_inputs(v, o.model_year),
                        deal=deal,
                        insurance=_insurance(b, profile, v.variant_id, basis_price, oid),
                        resale=None,
                    )
                )
                meta[oid] = {
                    "variant_id": v.variant_id,
                    "kind": "lease",
                    "seller": None,
                    "offer": o.offer_id,
                }

        # --- used: one option per model year in the right age band ------------
        for year in years:
            age = age_months_on(start, year)
            if 12 <= age < 48:
                kind, seller = "used_1_3", "dealer"
            elif age >= 60:
                kind, seller = "used_5_plus", "private"
            else:
                notes.append(f"{label_base} {year}: {age} months old, between the used bands")
                continue
            if kind not in allowed:
                continue
            cohort = b.cohort(f"{v.variant_id}:{year}")
            if cohort is None:
                notes.append(f"{label_base} {year}: no cohort point")
                continue
            km0 = cohort.ref_km
            value, status, _sigma = anchor_value(
                b.market, v.variant_id, year, age, km0, dealer=False
            )
            if seller == "dealer":
                price_val = mul(value, Decimal(1) + pct(r.dealer_margin_pct.value))
                price_status = "estimate"
                basis = "cohort asking value plus the dealer margin estimate"
            else:
                price_val = value
                price_status = status
                basis = (
                    None
                    if status == "live"
                    else "estimated from how similar cars hold their value (no listings yet)"
                )
            oid = f"{v.variant_id}:{year}:{kind}"
            price_in = In[int](
                id=f"{oid}.price",
                value=price_val,
                source="Market model, for a car at about " + f"{km0:,}".replace(",", NBSP) + " km",
                as_of=cohort.as_of,
                status=price_status,
                basis=basis,
            )
            friction = (
                r.dealer_exit_friction_pct if seller == "dealer" else r.private_exit_friction_pct
            ).model_copy(update={"id": f"{oid}.exit_friction_pct"})
            deal = Used(
                mode=kind,
                price_ore=price_in,
                age_months_at_purchase=age,
                km_at_purchase=km0,
                seller_type=seller,
                purchase_date=start,
                delivery_months=In[int](
                    id=f"{oid}.delivery_months",
                    value=0,
                    source="Used cars are in stock",
                    as_of=b.meta.bundle_as_of,
                ),
                loan=_loan(b, oid),
                exit_friction_pct=friction,
                remaining_warranty_months=max(0, v.warranty_years * 12 - age),
            )
            resale = value_path(
                b.market,
                v.variant_id,
                year,
                age,
                km0,
                profile.km_per_year,
                anchor_ore=value,
                as_of=b.meta.bundle_as_of,
            )
            sold_by = "from a dealer" if seller == "dealer" else "from a private seller"
            options.append(
                Option(
                    id=oid,
                    label=f"{label_base} {year}, used {sold_by}",
                    vehicle=_vehicle_inputs(v, year),
                    deal=deal,
                    insurance=_insurance(b, profile, v.variant_id, price_val, oid),
                    resale=resale,
                )
            )
            meta[oid] = {"variant_id": v.variant_id, "kind": kind, "seller": seller, "offer": None}

    if profile.pay_mode == "both":
        extra: list[Option] = []
        for o in options:
            if o.deal.mode != "lease" and getattr(o.deal, "loan", None) is not None:
                cash_id = f"{o.id}:cash"
                extra.append(
                    o.model_copy(
                        update={
                            "id": cash_id,
                            "label": f"{o.label}, paid cash",
                            "deal": o.deal.model_copy(update={"loan": None}),
                        }
                    )
                )
                meta[cash_id] = dict(meta[o.id], pay="cash")
                meta[o.id]["pay"] = "loan"
        options.extend(extra)
    if not options:
        raise ValueError("no options could be built from the selection: " + "; ".join(notes))
    return (
        Scenario(user=user, market=market, options=tuple(options), seed=seed, draws=draws),
        notes,
        meta,
    )
