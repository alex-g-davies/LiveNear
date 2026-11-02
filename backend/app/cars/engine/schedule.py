"""Assemble one option's monthly schedule (spec 022 R3, R5, R6).

Output is a `Schedule`: integer-øre line items split into cash flows
(paid in month k whatever happens later) and exit terms (due only if the
car is sold or returned in month t), plus the base vectors the Monte Carlo
needs to re-scale stochastic items without rebuilding anything.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Literal

from .calendar import add_months, days_in_month
from .finance import AmortRow, amortise, payoff
from .lease import early_exit_charge, excess_km_charge, lease_payment_schedule
from .models import (
    MONTHS,
    BuyNew,
    DefaultEarlyExit,
    FixedTable,
    Lease,
    MarketPolicyInputs,
    Option,
    PercentOfRemaining,
    Used,
    UserInputs,
)
from .money import Ore, mul, pct, share
from .provenance import Ctx

Group = Literal["cash", "exit"]

# Stable item keys and their display labels/order (R11 "Where the money goes").
ITEM_LABELS: dict[str, str] = {
    "purchase": "Purchase or down payment",
    "fees": "Fees and taxes",
    "re_registration": "Re-registration fee",
    "lease_payments": "Lease payments",
    "loan_payments": "Loan payments",
    "insurance": "Insurance",
    "traffic_tax": "Traffic insurance tax",
    "energy": "Energy",
    "tyres": "Tyres",
    "service": "Service",
    "wear_and_repairs": "Wear and repairs",
    "inspection": "Periodic inspection (EU-kontroll)",
    "tolls": "Road tolls",
    "delay": "Delay cost",
    "resale_value": "Value back at exit",
    "loan_payoff": "Loan repaid at sale",
    "early_exit": "Lease early-exit charge",
    "excess_km": "Excess km",
    "exit_friction": "Cost to exit",
}


@dataclass
class LineItem:
    key: str
    group: Group
    ore: list[int]  # 61 values; cash: paid in month k; exit: due if exiting at t
    used: frozenset[str]
    estimate: bool


@dataclass
class StochasticBases:
    """Everything the Monte Carlo rescales per draw (floats are made there)."""

    insurance_base: list[int]  # øre per month before the multiplier
    insurance_value: int  # annual premium, the median of the draw
    insurance_range: tuple[Decimal, Decimal] | None
    kwh_home: list[Decimal]  # kWh per month charged at home
    kwh_public: list[Decimal]
    home_price_ore: int
    home_range: tuple[Decimal, Decimal] | None
    public_price_ore: int
    public_range: tuple[Decimal, Decimal] | None
    loan_principal: int
    loan_term: int
    loan_rate_pct: Decimal | None
    loan_rate_range: tuple[Decimal, Decimal] | None
    loan_monthly_fee: int
    resale_p50: list[int] | None
    resale_log_sigma: list[float] | None
    friction_pct: Decimal
    drift_pct: Decimal
    drift_range: tuple[Decimal, Decimal] | None


@dataclass
class Schedule:
    option: Option
    items: dict[str, LineItem]
    km_at: list[int]
    bases: StochasticBases
    ctx: Ctx
    loan_rows: list[AmortRow] = field(default_factory=list)
    beyond_term: list[bool] = field(default_factory=lambda: [False] * MONTHS)

    def cash_items(self) -> list[LineItem]:
        return [i for i in self.items.values() if i.group == "cash"]

    def exit_items(self) -> list[LineItem]:
        return [i for i in self.items.values() if i.group == "exit"]

    def cash_total(self) -> list[int]:
        out = [0] * MONTHS
        for it in self.cash_items():
            for k in range(MONTHS):
                out[k] += it.ore[k]
        return out

    def exit_total(self) -> list[int]:
        out = [0] * MONTHS
        for it in self.exit_items():
            for k in range(MONTHS):
                out[k] += it.ore[k]
        return out


def _rng(inp) -> tuple[Decimal, Decimal] | None:
    return (inp.range.low, inp.range.high) if inp.range else None


def build_schedule(user: UserInputs, market: MarketPolicyInputs, option: Option) -> Schedule:
    ctx = Ctx()
    deal = option.deal
    veh = option.vehicle
    items: dict[str, LineItem] = {}

    def add(key: str, group: Group, ore: list[int], used: set[str], extra_estimate: bool = False):
        items[key] = LineItem(
            key, group, ore, frozenset(used), ctx.is_estimate(used) or extra_estimate
        )

    # ---- km path: cumulative km driven by month t (purchase day = 0) ----------
    km_at = [share(user.km_per_year, t, 12) for t in range(MONTHS)]

    # ---- delivery: months until the car arrives; the horizon starts at delivery,
    # the user rents meanwhile (build spec "Delay cost") ------------------------
    with ctx.item("delay") as used:
        delay_months = ctx.use(deal.delivery_months)
        rental = ctx.use(market.rental_per_month_ore)
        delay = [0] * MONTHS
        delay[0] = Ore(delay_months * rental)
    add("delay", "cash", delay, used)

    anchor: date = add_months(user.start_date, int(delay_months))

    # ---- deal-specific cash and exit items -------------------------------------
    loan_rows: list[AmortRow] = []
    beyond = [False] * MONTHS
    principal = 0
    loan_rate: Decimal | None = None
    loan_rate_range = None
    loan_fee_monthly = 0
    loan_term = 0
    friction_pct = Decimal(0)
    purchase_price = 0

    if isinstance(deal, Lease):
        with ctx.item("lease_payments") as used:
            cf, beyond = lease_payment_schedule(
                ctx.use(deal.monthly_ore),
                ctx.use(deal.upfront_ore),
                0,
                deal.term_months,
                deal.pay_in_advance,
            )
        add("lease_payments", "cash", cf, used, extra_estimate=False)
        with ctx.item("fees") as used:
            fees = [0] * MONTHS
            fees[0] = ctx.use(deal.fees_ore)
        add("fees", "cash", fees, used)
        with ctx.item("excess_km") as used:
            ex = excess_km_charge(
                km_at,
                ctx.use(deal.km_cap_per_year),
                ctx.use(deal.excess_km_fee_ore),
                deal.term_months,
            )
        add("excess_km", "exit", ex, used)
        with ctx.item("early_exit") as used:
            rule = deal.early_exit
            monthly = ctx.use(deal.monthly_ore)
            if isinstance(rule, PercentOfRemaining):
                ee = early_exit_charge(
                    rule, monthly, deal.term_months, percent=ctx.use(rule.percent)
                )
            elif isinstance(rule, FixedTable):
                ctx.use(rule.source)
                ee = early_exit_charge(rule, monthly, deal.term_months, table=rule.by_month)
            else:
                assert isinstance(rule, DefaultEarlyExit)
                ee = early_exit_charge(
                    rule, monthly, deal.term_months, recovery_pct=ctx.use(rule.recovery_pct)
                )
        add("early_exit", "exit", ee, used)
        with ctx.item("exit_friction") as used:
            eol = ctx.use(deal.end_of_lease_fee_ore)
            fr = [0] + [eol] * (MONTHS - 1)
        add("exit_friction", "exit", fr, used)
    else:
        assert isinstance(deal, BuyNew | Used)
        with ctx.item("purchase") as used:
            purchase_price = ctx.use(deal.price_ore)
            loan = deal.loan if user.pay_mode == "loan" else None
            pay0 = [0] * MONTHS
            if loan is not None:
                down = min(user.down_payment_ore, purchase_price)
                principal = purchase_price - down
                pay0[0] = down
            else:
                pay0[0] = purchase_price
        add("purchase", "cash", pay0, used)

        fees_vec = [0] * MONTHS
        with ctx.item("fees") as used:
            if isinstance(deal, BuyNew):
                fees_vec[0] += ctx.use(deal.fees_ore)
            if loan is not None:
                fees_vec[0] += ctx.use(loan.establishment_fee_ore)
        add("fees", "cash", fees_vec, used)

        if isinstance(deal, Used):
            with ctx.item("re_registration") as used:
                rule, carried = market.tax_rules.rule_at("re_registration_fee", deal.purchase_date)
                fee = _re_registration_fee(rule.params, veh, deal.age_months_at_purchase)
                ctx.note(
                    rule.id,
                    fee,
                    rule.source_url,
                    rule.effective_from,
                    "live" if rule.status == "live" and not carried else "estimate",
                    rule.note
                    or ("rule carried forward past its dated window" if carried else None),
                )
                rr = [0] * MONTHS
                rr[0] = fee
            add("re_registration", "cash", rr, used, extra_estimate=carried)

        if loan is not None:
            with ctx.item("loan_payments") as used:
                loan_rate = ctx.use(loan.annual_rate_pct)
                loan_rate_range = _rng(loan.annual_rate_pct)
                loan_fee_monthly = ctx.use(loan.monthly_fee_ore)
                loan_term = loan.term_months
                loan_rows = amortise(principal, loan_rate, loan_term)
                lp = [0] * MONTHS
                for row in loan_rows:
                    if row.month < MONTHS:
                        lp[row.month] = row.payment + loan_fee_monthly
            add("loan_payments", "cash", lp, used)
            with ctx.item("loan_payoff") as used:
                po = [payoff(loan_rows, t) for t in range(MONTHS)]
                ctx.use(loan.annual_rate_pct)
            add("loan_payoff", "exit", po, used)

        assert option.resale is not None
        with ctx.item("resale_value") as used:
            ctx.use(option.resale.source)
            drift = Decimal(ctx.use(market.used_price_drift))
            drifted = [
                option.resale.p50_ore[0],
                *(
                    mul(v, (drift / Decimal(100) * Decimal(t) / Decimal(12)).exp())
                    for t, v in enumerate(option.resale.p50_ore)
                    if t > 0
                ),
            ]
            resale = [-v for v in drifted]  # value back: negative cost
        add("resale_value", "exit", resale, used)
        with ctx.item("exit_friction") as used:
            friction_pct = pct(ctx.use(deal.exit_friction_pct))
            fr = [mul(v, friction_pct) for v in drifted]
            fr[0] = 0
        add("exit_friction", "exit", fr, used)

    # ---- insurance ---------------------------------------------------------------
    lease_includes = deal.includes if isinstance(deal, Lease) else ()
    with ctx.item("insurance") as used:
        annual = 0 if "insurance" in lease_includes else ctx.use(option.insurance.annual_ore)
        ins = [0] + [share(annual, 1, 12)] * (MONTHS - 1)
    add("insurance", "cash", ins, used)

    # ---- traffic insurance tax: daily rate × days, per calendar month -------------
    with ctx.item("traffic_tax") as used:
        tt = [0] * MONTHS
        any_carried = False
        for k in range(1, MONTHS):
            on = add_months(anchor, k - 1)
            rule, carried = market.tax_rules.rule_at("traffic_insurance_tax", on)
            any_carried |= carried
            per_day = int(rule.params[veh.energy_type])  # type: ignore[index]
            ctx.note(
                rule.id,
                rule.params,
                rule.source_url,
                rule.effective_from,
                "live" if rule.status == "live" and not carried else "estimate",
                rule.note or ("rule carried forward past its dated window" if carried else None),
            )
            tt[k] = per_day * days_in_month(on)
    add("traffic_tax", "cash", tt, used, extra_estimate=any_carried)

    # ---- energy ------------------------------------------------------------------
    with ctx.item("energy") as used:
        wh = Decimal(ctx.use(veh.efficiency_wh_per_km)) * ctx.use(veh.winter_factor)
        mix = user.charging_mix
        home_p = ctx.use(market.charging.home_ore_per_kwh)
        pub_p = ctx.use(market.charging.public_ore_per_kwh)
        kwh_home: list[Decimal] = [Decimal(0)] * MONTHS
        kwh_public: list[Decimal] = [Decimal(0)] * MONTHS
        en = [0] * MONTHS
        for k in range(1, MONTHS):
            km_month = km_at[k] - km_at[k - 1]
            kwh = Decimal(km_month) * wh / Decimal(1000)
            kwh_home[k] = kwh * mix.home_pct / 100
            kwh_public[k] = kwh * mix.public_pct / 100
            en[k] = mul(home_p, kwh_home[k]) + mul(pub_p, kwh_public[k])
    add("energy", "cash", en, used)

    # ---- tyres: winter set at purchase unless included; replacements by km;
    # two wheel changes a year (024 R4) ------------------------------------------
    with ctx.item("tyres") as used:
        ty = [0] * MONTHS
        if "tyres" not in lease_includes:
            set_cost = ctx.use(veh.tyre_set_ore)
            life = ctx.use(veh.tyre_life_km)
            wheel_change = ctx.use(market.wheel_change_ore)
            ty[0] = set_cost
            replaced = 0
            for k in range(1, MONTHS):
                if km_at[k] // life > replaced:
                    replaced = km_at[k] // life
                    ty[k] += set_cost
                if k % 6 == 0:
                    ty[k] += wheel_change
    add("tyres", "cash", ty, used)

    age0 = _age_months_at_start(deal)  # months since first registration at month 0
    odo0 = deal.km_at_purchase if isinstance(deal, Used) else 0

    # ---- service: booked when either interval elapses since the last one (024 R1)
    with ctx.item("service") as used:
        sv = [0] * MONTHS
        history_unknown = False
        if "service" not in lease_includes and veh.service_interval_months > 0:
            price = ctx.use(veh.service_price_ore)
            first_price = (
                ctx.use(veh.service_first_price_ore)
                if veh.service_first_price_ore is not None
                else None
            )
            older_price = (
                ctx.use(veh.service_price_after_7y_ore)
                if veh.service_price_after_7y_ore is not None
                else None
            )
            every_m = veh.service_interval_months
            every_km = veh.service_interval_km
            first_m = veh.service_first_months or every_m
            last_m, last_km, done = 0, 0, 0
            for k in range(1, MONTHS):
                gap_m = first_m if (done == 0 and age0 == 0) else every_m
                due = (k - last_m >= gap_m) or (every_km > 0 and km_at[k] - last_km >= every_km)
                if not due:
                    continue
                amount = price
                if done == 0 and age0 == 0 and first_price is not None:
                    amount = first_price
                if older_price is not None and age0 + k >= 84:
                    amount = older_price
                sv[k] = amount
                last_m, last_km, done = k, km_at[k], done + 1
            # A private seller's service history is unknown: the next service
            # may be due sooner than one full interval.
            history_unknown = isinstance(deal, Used) and deal.seller_type == "private"
    add("service", "cash", sv, used, extra_estimate=history_unknown)

    # ---- wear items per year + repair allowance rising with the odometer (024 R2)
    with ctx.item("wear_and_repairs") as used:
        wr = [0] * MONTHS
        wear = 0 if "service" in lease_includes else ctx.use(veh.wear_per_year_ore)
        rep = market.repair
        ctx.use(rep.source)
        ev_factor = ctx.use(rep.ev_factor) if veh.energy_type == "ev" else Decimal(1)
        in_warranty_factor = ctx.use(rep.in_warranty_factor)
        warranty_months = veh.warranty_years * 12
        for k in range(1, MONTHS):
            km_month = km_at[k] - km_at[k - 1]
            odo = odo0 + km_at[k]
            in_warranty = (age0 + k) <= warranty_months and odo <= veh.warranty_km
            factor = ev_factor * (in_warranty_factor if in_warranty else Decimal(1))
            wr[k] = share(wear, 1, 12) + mul(rep.ore_per_km_at(odo) * km_month, factor)
    add("wear_and_repairs", "cash", wr, used)

    # ---- periodic inspection: rule cycle from first registration (024 R3) -------
    with ctx.item("inspection") as used:
        insp = [0] * MONTHS
        rule, carried = market.tax_rules.rule_at("periodic_inspection", anchor)
        fee = ctx.use(market.inspection_fee_ore)
        ctx.note(
            rule.id,
            rule.params,
            rule.source_url,
            rule.effective_from,
            "live" if rule.status == "live" and not carried else "estimate",
            rule.note or ("rule carried forward past its dated window" if carried else None),
        )
        first_after = int(rule.params["first_after_months"])  # type: ignore[arg-type]
        every = int(rule.params["every_months"])  # type: ignore[arg-type]
        for k in range(1, MONTHS):
            age = age0 + k
            if age >= first_after and (age - first_after) % every == 0:
                insp[k] = fee
    add("inspection", "cash", insp, used, extra_estimate=carried)

    # ---- road tolls: passages per week × blended EV rate, monthly cap (024 R5) ---
    with ctx.item("tolls") as used:
        tl = [0] * MONTHS
        ring = market.toll_ring
        if ring is not None and user.toll_passages_per_week > 0:
            ctx.use(ring.source)
            off = ctx.use(ring.offpeak_ore)
            rush = ctx.use(ring.rush_ore)
            per_month = Decimal(user.toll_passages_per_week) * 52 / 12
            if ring.monthly_cap_passages > 0:
                per_month = min(per_month, Decimal(ring.monthly_cap_passages))
            monthly = mul(off + rush, per_month / 2)
            for k in range(1, MONTHS):
                tl[k] = monthly
    add("tolls", "cash", tl, used)

    bases = StochasticBases(
        insurance_base=ins,
        insurance_value=option.insurance.annual_ore.value,
        insurance_range=_rng(option.insurance.annual_ore),
        kwh_home=kwh_home,
        kwh_public=kwh_public,
        home_price_ore=market.charging.home_ore_per_kwh.value,
        home_range=_rng(market.charging.home_ore_per_kwh),
        public_price_ore=market.charging.public_ore_per_kwh.value,
        public_range=_rng(market.charging.public_ore_per_kwh),
        loan_principal=principal,
        loan_term=loan_term,
        loan_rate_pct=loan_rate,
        loan_rate_range=loan_rate_range,
        loan_monthly_fee=loan_fee_monthly,
        resale_p50=list(option.resale.p50_ore) if option.resale else None,
        resale_log_sigma=list(option.resale.log_sigma) if option.resale else None,
        friction_pct=friction_pct,
        drift_pct=market.used_price_drift.value,
        drift_range=_rng(market.used_price_drift),
    )
    sched = Schedule(option, items, km_at, bases, ctx, loan_rows, beyond)
    if isinstance(deal, Lease) and any(beyond):
        # Months past the first term assume a repeat lease: an estimate (R3).
        items["lease_payments"].estimate = True
    return sched


def _age_months_at_start(deal) -> int:
    """Months since first registration at month 0 of the schedule."""
    if isinstance(deal, Used):
        return deal.age_months_at_purchase
    if isinstance(deal, Lease):
        return deal.age_months_at_start
    return 0


def _re_registration_fee(params: dict[str, object], veh, age_months: int) -> int:
    """Fee table from the rules file: bands by vehicle age in years; EVs may
    pay a fraction. Values are øre."""
    bands = params["age_bands_ore"]  # type: ignore[index]
    years = age_months // 12
    fee = 0
    for band in bands:  # type: ignore[union-attr]
        if years >= int(band["min_years"]):  # type: ignore[index]
            fee = int(band["ore"])  # type: ignore[index]
    factor = Decimal(str(params.get("ev_factor", "1"))) if veh.energy_type == "ev" else Decimal(1)
    return mul(fee, factor)
