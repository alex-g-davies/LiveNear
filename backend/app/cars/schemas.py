"""API request/response models for /api/cars (spec 022 R10).

The profile mirrors what the browser stores (R2); nothing here is persisted
server-side. Engine result models (`engine.result`, `engine.run`) are reused
directly in responses so field names stay in one place.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .bundle_schema import ListingsMode, SourceHealth
from .engine.models import Mode
from .engine.result import OptionResult
from .engine.run import RuledOut, SensitivityRow

Measure = Literal["per_month", "tco", "npc", "cash_up_front", "per_km"]

# Spec 024 R18: one scenario may compare this many distinct variants. The
# whole catalogue must fit (a test asserts it) so every recommendation can
# be added to the comparison; `frontend/src/cars/lib/market.ts` mirrors the
# number so the screens stop adding cars before the server would refuse.
MAX_COMPARE_VARIANTS = 30


class ExitOddsIn(BaseModel):
    p12: int = Field(ge=0, le=100)
    p24: int = Field(ge=0, le=100)
    p36: int = Field(ge=0, le=100)
    p48: int = Field(ge=0, le=100)


class ChargingMixIn(BaseModel):
    home_pct: int = Field(ge=0, le=100)
    work_free_pct: int = Field(ge=0, le=100)
    public_pct: int = Field(ge=0, le=100)


class InsuranceProfileIn(BaseModel):
    age_band: Literal["18-24", "25-29", "30-39", "40-49", "50-64", "65+"] = "30-39"
    claims_free_years: int = Field(default=0, ge=0, le=40)
    has_claims_free_letter: bool = False


class LimitsIn(BaseModel):
    max_price_nok: int | None = Field(default=None, ge=0)
    need_by: date | None = None
    must_haves: list[Literal["heat_pump", "auto_precondition", "awd"]] = Field(default_factory=list)
    modes: list[Mode] = Field(default_factory=lambda: ["new", "lease", "used_1_3", "used_5_plus"])


class Profile(BaseModel):
    """Everything the Situation screen collects (R2, R11)."""

    exit_odds: ExitOddsIn = ExitOddsIn(p12=15, p24=35, p36=35, p48=15)
    km_per_year: int = Field(default=12_000, gt=0, le=100_000)
    charging_mix: ChargingMixIn = ChargingMixIn(home_pct=70, work_free_pct=20, public_pct=10)
    municipality: str = ""
    toll_passages_per_week: int = Field(default=0, ge=0, le=200)  # 024 R5
    export_on_exit: bool = False
    pay_mode: Literal["cash", "loan", "both"] = "loan"
    return_on_cash_pct: Decimal = Field(default=Decimal("4"), ge=0, le=30)
    down_payment_nok: int = Field(default=0, ge=0)
    has_id_and_bankid: bool = False
    insurance: InsuranceProfileIn = InsuranceProfileIn()
    insurance_quotes_nok: dict[str, int] = Field(default_factory=dict)  # variant_id -> annual NOK
    limits: LimitsIn = LimitsIn()
    fun_weight: int = Field(default=50, ge=0, le=100)
    preferred_measure: Measure = "per_month"
    start_date: date | None = None  # defaults to today on the server
    arrival_date: date | None = None  # checklist due dates only (023 R5); the engine ignores it


class SelectionItem(BaseModel):
    variant_id: str
    year_from: int = Field(ge=2010, le=2030)
    year_to: int = Field(ge=2010, le=2030)


class WhatIfIn(BaseModel):
    return_on_cash_pct: Decimal | None = Field(default=None, ge=0, le=30)
    loan_rate_pct: Decimal | None = Field(default=None, ge=0, le=30)
    km_per_year: int | None = Field(default=None, gt=0, le=100_000)
    used_price_drift_pct: Decimal | None = Field(default=None, ge=-30, le=30)
    pay_mode: Literal["cash", "loan"] | None = None


class ScenarioRequest(BaseModel):
    profile: Profile
    # Items, not variants: the Market map and the recommendation strip pick
    # single model years, so one variant can arrive as several ranges.
    selection: list[SelectionItem] = Field(min_length=1, max_length=4 * MAX_COMPARE_VARIANTS)
    what_if: WhatIfIn | None = None
    overrides: dict[str, str | int | float] = Field(default_factory=dict)  # input id -> value
    measure: Measure = "per_month"
    seed: int = 0
    draws: int = Field(default=2000, ge=100, le=5000)

    @field_validator("selection")
    @classmethod
    def _cap_distinct_variants(cls, v: list[SelectionItem]) -> list[SelectionItem]:
        n = len({s.variant_id for s in v})
        if n > MAX_COMPARE_VARIANTS:
            raise ValueError(
                f"you can compare up to {MAX_COMPARE_VARIANTS} cars at once, not {n}; "
                "remove some and try again"
            )
        return v


class OptionSummary(BaseModel):
    """Per-option payload: the engine result plus the ids the UI needs."""

    result: OptionResult
    variant_id: str
    option_kind: str  # new | lease | used_1_3 | used_5_plus
    seller_type: str | None = None
    lease_offer_id: str | None = None


class ScenarioResponse(BaseModel):
    ranking_measure: Measure
    exit_odds: dict[int, int]
    seed: int
    draws: int
    bundle_as_of: date
    start_date: date
    options: list[OptionSummary]
    ruled_out: list[RuledOut]
    skipped: list[str]  # selections that produced no option, with the reason
    sensitivity: list[SensitivityRow]
    sensitivity_option_id: str | None
    elapsed_ms: int


class RecommendRequest(BaseModel):
    """Spec 024 R11: the profile alone; the server considers the whole catalogue."""

    profile: Profile
    measure: Measure = "per_month"
    n: int = Field(default=5, ge=1, le=10)
    seed: int = 0
    draws: int = Field(default=500, ge=100, le=1000)


class RecommendRow(BaseModel):
    rank: int  # position in the full ranking by the requested measure (1 = best)
    reasons: list[str]
    summary: OptionSummary


class RecommendResponse(BaseModel):
    ranking_measure: Measure
    bundle_as_of: date
    start_date: date
    n_considered: int  # options built and ranked
    ruled_out: dict[str, int]  # reason -> number of options it excluded
    skipped: int  # selections that produced no option (no price, no cohort, age gap)
    rows: list[RecommendRow]
    elapsed_ms: int


class VehicleOut(BaseModel):
    variant_id: str
    make: str
    model: str
    trim_group: str
    segment: str
    model_years: list[int]
    energy_type: str
    drive: str
    body: str
    battery_kwh: Decimal | None
    power_kw: int | None
    heat_pump: bool
    auto_precondition: bool
    range_km_wltp: int | None
    accel_0_100_s: Decimal | None
    fun_score: Decimal
    new_price_ore: int | None  # latest list price if on file
    has_lease_offer: bool


class CohortOut(BaseModel):
    cohort_id: str
    variant_id: str
    make: str
    model: str
    trim_group: str
    model_year: int
    energy_type: str
    drive: str
    body: str
    n_listings: int
    ref_km: int
    value_ref_ore: int
    pi_low_ore: int
    pi_high_ore: int
    status: str
    as_of: date
    range_km_wltp: int | None
    efficiency_wh_per_km: int
    accel_0_100_s: Decimal | None
    meets_must_haves: bool


class CohortsResponse(BaseModel):
    bundle_as_of: date
    listings_mode: ListingsMode
    n_listings_total: int
    cohorts: list[CohortOut]


class ListingOut(BaseModel):
    listing_id: str  # hashed
    snapshot_date: date
    ask_ore: int
    km: int
    model_year: int
    seller_type: str
    first_reg_month: str | None
    status: str


class ListingsResponse(BaseModel):
    cohort_id: str
    listings_mode: ListingsMode
    listings: list[ListingOut]


class MarketPoint(BaseModel):
    """One dot on the market map (spec 023 R1): a listing in its latest
    `listed` snapshot. Hashed id only; no URL, seller name, location or
    registration number is ever served."""

    listing_id: str
    variant_id: str
    cohort_id: str
    model_year: int
    ask_ore: int
    km: int
    seller_type: str
    first_reg_month: str | None
    snapshot_date: date


class MarketPointsResponse(BaseModel):
    bundle_as_of: date
    listings_mode: ListingsMode
    n_points: int
    points: list[MarketPoint]


class SourcesResponse(BaseModel):
    bundle_as_of: date
    listings_mode: ListingsMode
    sources: list[SourceHealth]
    pending_rules: list[dict]
    unverified_rules: list[str]
