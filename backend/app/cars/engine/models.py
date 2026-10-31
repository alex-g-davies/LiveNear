"""Typed engine inputs: the four layers of the build spec (spec 022 R3, R5).

Every leaf value that comes from outside the user's own typing is wrapped in
`In[T]`, which carries provenance: id, source, as-of date, status and, for
defaults, the written basis (R5 "no silent defaults"). The maths never sees
these wrappers — `provenance.Ctx.use()` unwraps and records the id.

Horizon is fixed at 60 months (month 0 = purchase/delivery day).
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Annotated, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, model_validator

HORIZON_MONTHS = 60
MONTHS = HORIZON_MONTHS + 1  # indices 0..60
EXIT_POINTS = (12, 24, 36, 48)

Status = Literal["live", "estimate"]
Mode = Literal["new", "lease", "used_1_3", "used_5_plus"]
EnergyType = Literal["ev", "phev", "hybrid", "ice"]
Drive = Literal["rwd", "fwd", "awd"]
SellerType = Literal["dealer", "private"]
PayMode = Literal["cash", "loan"]

T = TypeVar("T")


class Range(BaseModel):
    """P10–P90 band of an uncertain input, in the input's own units."""

    model_config = ConfigDict(frozen=True)
    low: Decimal
    high: Decimal

    @model_validator(mode="after")
    def _ordered(self) -> Range:
        if self.low > self.high:
            raise ValueError("Range.low must be <= Range.high")
        return self


class In(BaseModel, Generic[T]):
    """A provenance-carrying input value (R5)."""

    model_config = ConfigDict(frozen=True)

    id: str
    value: T
    source: str
    as_of: date
    status: Status = "live"
    basis: str | None = Field(
        default=None,
        description="Required for estimates: how the default was chosen.",
    )
    range: Range | None = Field(
        default=None,
        description="P10–P90 band used by the Monte Carlo draw, if the input is uncertain.",
    )

    @model_validator(mode="after")
    def _estimates_have_a_basis(self) -> In[T]:
        if self.status == "estimate" and not self.basis:
            raise ValueError(f"input {self.id!r} is an estimate but has no basis")
        return self


# --------------------------------------------------------------------------- user


class ExitOdds(BaseModel):
    """Owner's odds of leaving at each exit point, whole percent, summing to 100."""

    model_config = ConfigDict(frozen=True)
    p12: int = Field(ge=0, le=100)
    p24: int = Field(ge=0, le=100)
    p36: int = Field(ge=0, le=100)
    p48: int = Field(ge=0, le=100)

    @model_validator(mode="after")
    def _sums_to_100(self) -> ExitOdds:
        if self.p12 + self.p24 + self.p36 + self.p48 != 100:
            raise ValueError("exit odds must sum to 100")
        return self

    def as_dict(self) -> dict[int, int]:
        return {12: self.p12, 24: self.p24, 36: self.p36, 48: self.p48}


class ChargingMix(BaseModel):
    """Share of energy by where it is charged, whole percent summing to 100."""

    model_config = ConfigDict(frozen=True)
    home_pct: int = Field(ge=0, le=100)
    work_free_pct: int = Field(ge=0, le=100)
    public_pct: int = Field(ge=0, le=100)

    @model_validator(mode="after")
    def _sums_to_100(self) -> ChargingMix:
        if self.home_pct + self.work_free_pct + self.public_pct != 100:
            raise ValueError("charging mix must sum to 100")
        return self


class InsuranceProfile(BaseModel):
    model_config = ConfigDict(frozen=True)
    age_band: Literal["18-24", "25-29", "30-39", "40-49", "50-64", "65+"]
    claims_free_years: int = Field(ge=0, le=40)
    has_claims_free_letter: bool = False


class Limits(BaseModel):
    """Hard filters (R11): never weighted against cost."""

    model_config = ConfigDict(frozen=True)
    max_price_ore: int | None = None
    need_by: date | None = None
    must_haves: tuple[Literal["heat_pump", "auto_precondition", "awd"], ...] = ()
    modes: tuple[Mode, ...] = ("new", "lease", "used_1_3", "used_5_plus")


class UserInputs(BaseModel):
    model_config = ConfigDict(frozen=True)
    exit_odds: ExitOdds
    km_per_year: int = Field(gt=0, le=100_000)
    charging_mix: ChargingMix
    municipality: str = ""
    pay_mode: PayMode = "loan"
    return_on_cash_pct: Decimal = Field(default=Decimal("4"), ge=0, le=30)
    down_payment_ore: int = Field(default=0, ge=0)
    insurance: InsuranceProfile
    limits: Limits = Limits()
    fun_weight: int = Field(default=50, ge=0, le=100)
    # Month 0 of every option is anchored here; a later delivery pushes the
    # schedule and adds delay cost (R3).
    start_date: date


# ------------------------------------------------------------------------ vehicle


class VehicleInputs(BaseModel):
    model_config = ConfigDict(frozen=True)
    variant_id: str
    make: str
    model: str
    trim_group: str
    model_year: int = Field(ge=2010, le=2030)
    energy_type: EnergyType = "ev"
    drive: Drive = "rwd"
    body: str = ""
    battery_kwh: Decimal | None = None
    power_kw: int | None = None
    heat_pump: bool = True
    auto_precondition: bool = True
    tyre_size: str = ""
    weight_kg: int | None = None
    # Real-world energy use at mild temperatures; the winter factor lifts it.
    efficiency_wh_per_km: In[int]
    winter_factor: In[Decimal]
    # A second (winter) set, bought at purchase unless the deal includes tyres.
    tyre_set_ore: In[int]
    tyre_life_km: In[int]
    # Service as an annual amount; leases that include service zero it.
    service_per_year_ore: In[int]
    warranty_years: int = 5
    warranty_km: int = 100_000
    fun_score: In[Decimal]  # 0–10, shown next to cost, never folded in (R11)
    new_price_ore: In[int] | None = None  # for retention display; may be absent


# --------------------------------------------------------------------------- deals


class Loan(BaseModel):
    model_config = ConfigDict(frozen=True)
    annual_rate_pct: In[Decimal]  # nominal annual, monthly compounding
    term_months: int = Field(gt=0, le=120)
    establishment_fee_ore: In[int]
    monthly_fee_ore: In[int]


class ResalePath(BaseModel):
    """What the market model hands the engine for one option: the P50 resale
    value in øre at each month 0..60 and the log-space sigma of a single car's
    predictive distribution at each month (R4, R7)."""

    model_config = ConfigDict(frozen=True)
    p50_ore: tuple[int, ...]
    log_sigma: tuple[float, ...]
    source: In[str]  # provenance of the path as a whole (cohort id, fit date, status)

    @model_validator(mode="after")
    def _lengths(self) -> ResalePath:
        if len(self.p50_ore) != MONTHS or len(self.log_sigma) != MONTHS:
            raise ValueError(f"resale path needs {MONTHS} monthly points")
        if any(v < 0 for v in self.p50_ore) or any(s < 0 for s in self.log_sigma):
            raise ValueError("resale path values must be non-negative")
        return self


class PercentOfRemaining(BaseModel):
    """Early-exit charge = percent of the remaining lease payments."""

    model_config = ConfigDict(frozen=True)
    kind: Literal["percent_of_remaining"] = "percent_of_remaining"
    percent: In[Decimal]


class FixedTable(BaseModel):
    """Early-exit charge by month of exit, in øre; last entry carries forward."""

    model_config = ConfigDict(frozen=True)
    kind: Literal["fixed_table"] = "fixed_table"
    by_month: dict[int, int]
    source: In[str]


class DefaultEarlyExit(BaseModel):
    """The build spec's default rule, always an estimate: the lessee owes the
    remaining payments less a fraction the lessor recovers by re-leasing."""

    model_config = ConfigDict(frozen=True)
    kind: Literal["default_estimate"] = "default_estimate"
    recovery_pct: In[Decimal]


EarlyExit = Annotated[
    PercentOfRemaining | FixedTable | DefaultEarlyExit, Field(discriminator="kind")
]


class BuyNew(BaseModel):
    model_config = ConfigDict(frozen=True)
    mode: Literal["new"] = "new"
    price_ore: In[int]  # list price incl. VAT per the rule in force on registration
    fees_ore: In[int]  # delivery, registration handling
    delivery_months: In[int]
    registered_on: date
    loan: Loan | None = None
    exit_friction_pct: In[Decimal]  # dealer trade-in discount at sale


class Lease(BaseModel):
    model_config = ConfigDict(frozen=True)
    mode: Literal["lease"] = "lease"
    term_months: int = Field(gt=0, le=60)
    monthly_ore: In[int]
    upfront_ore: In[int]  # "startleie"
    fees_ore: In[int]
    km_cap_per_year: In[int]
    excess_km_fee_ore: In[int]  # per km over the pro-rated cap
    includes: tuple[Literal["tyres", "service", "insurance"], ...] = ()
    early_exit: EarlyExit
    end_of_lease_fee_ore: In[int]  # return inspection / damage allowance
    delivery_months: In[int]
    pay_in_advance: bool = True


class Used(BaseModel):
    model_config = ConfigDict(frozen=True)
    mode: Literal["used_1_3", "used_5_plus"]
    price_ore: In[int]  # cohort value at the car's km, plus dealer margin if any
    age_months_at_purchase: int = Field(ge=0, le=240)
    km_at_purchase: int = Field(ge=0)
    seller_type: SellerType
    purchase_date: date
    delivery_months: In[int]
    loan: Loan | None = None
    exit_friction_pct: In[Decimal]
    remaining_warranty_months: int = 0


Deal = Annotated[BuyNew | Lease | Used, Field(discriminator="mode")]


# ------------------------------------------------------------- market and policy


class TaxRule(BaseModel):
    """One dated rule from rules/tax_rules.yaml (R6). `params` are kind-specific."""

    model_config = ConfigDict(frozen=True)
    id: str
    kind: Literal["traffic_insurance_tax", "re_registration_fee", "ev_vat"]
    effective_from: date
    effective_to: date | None = None
    params: dict[str, object]
    source_url: str
    status: Literal["live", "estimate", "unverified"] = "live"
    note: str = ""


class TaxRuleSet(BaseModel):
    model_config = ConfigDict(frozen=True)
    rules: tuple[TaxRule, ...]

    def rule_at(self, kind: str, on: date) -> tuple[TaxRule, bool]:
        """The single rule of `kind` in force on `on`, plus a flag that is
        True when the date is past the last dated rule and we carried it
        forward (which the caller must flag Estimate). Raises on 0 or >1
        matches inside the dated window (R6)."""
        of_kind = [r for r in self.rules if r.kind == kind]
        if not of_kind:
            raise LookupError(f"no tax rule of kind {kind!r}")
        hits = [
            r
            for r in of_kind
            if r.effective_from <= on and (r.effective_to is None or on < r.effective_to)
        ]
        if len(hits) > 1:
            raise LookupError(f"{len(hits)} rules of kind {kind!r} overlap on {on.isoformat()}")
        if len(hits) == 1:
            return hits[0], False
        last = max(of_kind, key=lambda r: r.effective_from)
        if on > last.effective_from:
            return last, True
        raise LookupError(f"no rule of kind {kind!r} in force on {on.isoformat()}")


class ChargingPrices(BaseModel):
    model_config = ConfigDict(frozen=True)
    home_ore_per_kwh: In[int]
    public_ore_per_kwh: In[int]


class InsuranceDefault(BaseModel):
    """Annual premium for this profile × vehicle until the user enters a quote."""

    model_config = ConfigDict(frozen=True)
    annual_ore: In[int]


class MarketPolicyInputs(BaseModel):
    model_config = ConfigDict(frozen=True)
    tax_rules: TaxRuleSet
    charging: ChargingPrices
    # Annual log-drift of used prices, P10–P90 in `range`; shared across options.
    used_price_drift: In[Decimal]
    # What a month without the car costs the user (rental) while waiting.
    rental_per_month_ore: In[int]
    materiality_threshold: In[Decimal]  # share of expected TCO; see provenance


# ------------------------------------------------------------------------- option


class Option(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str
    label: str
    vehicle: VehicleInputs
    deal: Deal
    insurance: InsuranceDefault
    resale: ResalePath | None = None  # None for leases


class Scenario(BaseModel):
    model_config = ConfigDict(frozen=True)
    user: UserInputs
    market: MarketPolicyInputs
    options: tuple[Option, ...]
    seed: int = 0
    draws: int = Field(default=2000, ge=1, le=20_000)

    @model_validator(mode="after")
    def _resale_where_needed(self) -> Scenario:
        for o in self.options:
            if o.deal.mode != "lease" and o.resale is None:
                raise ValueError(f"option {o.id!r} needs a resale path")
        ids = [o.id for o in self.options]
        if len(set(ids)) != len(ids):
            raise ValueError("option ids must be unique")
        return self
