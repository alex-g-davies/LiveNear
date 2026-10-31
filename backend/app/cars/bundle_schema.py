"""The derived data bundle committed under backend/data/cars/ (spec 022 R9).

One JSON file per entity, all validated by these models. The ingestion +
market fit (`app.cars.market.bundle`) writes them; `app.cars.data_bundle`
loads them at startup. Amounts are integer øre; every outside value carries
provenance via the engine's `In[...]` wrapper so the API can show source,
date and status for everything (R5).

Files:
  meta.json          BundleMeta
  vehicles.json      list[VariantRecord]
  cohorts.json       list[CohortPoint]
  market_model.json  MarketModelParams
  new_prices.json    list[NewPriceRecord]
  lease_offers.json  list[LeaseOfferRecord]
  rates.json         RatesRecord
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .engine.models import Drive, EnergyType, In, Status

ListingsMode = Literal["r2", "fixture", "unavailable"]


class SourceHealth(BaseModel):
    name: str
    last_fetch: date | None = None
    rows: int = 0
    quarantined: int = 0
    status: Literal["ok", "stale", "failed", "manual", "disabled"] = "manual"
    note: str = ""


class BundleMeta(BaseModel):
    model_config = ConfigDict(frozen=True)
    bundle_as_of: date
    schema_version: int = 1
    sources: list[SourceHealth] = Field(default_factory=list)
    note: str = ""


class VariantRecord(BaseModel):
    """A trim group of a model: the unit the market map and selection use."""

    model_config = ConfigDict(frozen=True)
    variant_id: str
    make: str
    model: str
    trim_group: str
    segment: str  # pooling key for the market model, e.g. "ev-compact", "ev-mid-suv"
    model_years: tuple[int, ...]
    energy_type: EnergyType = "ev"
    drive: Drive = "rwd"
    body: str = ""
    battery_kwh: Decimal | None = None
    power_kw: int | None = None
    heat_pump: bool = True
    auto_precondition: bool = True
    tyre_size: str = ""
    weight_kg: int | None = None
    efficiency_wh_per_km: In[int]
    winter_factor: In[Decimal]
    tyre_set_ore: In[int]
    tyre_life_km: In[int]
    service_per_year_ore: In[int]
    warranty_years: int = 5
    warranty_km: int = 100_000
    fun_score: In[Decimal]
    range_km_wltp: int | None = None
    accel_0_100_s: Decimal | None = None


class CohortPoint(BaseModel):
    """One point on the market map: variant × model year at its reference km."""

    model_config = ConfigDict(frozen=True)
    cohort_id: str  # f"{variant_id}:{model_year}"
    variant_id: str
    model_year: int
    n_listings: int
    ref_km: int
    value_ref_ore: int  # P50 asking-price model at ref_km (median, not mean)
    pi_low_ore: int  # whisker: uncertainty of the cohort value
    pi_high_ore: int
    sigma_car: float  # log-space sd of a single car around the cohort value
    status: Status
    as_of: date
    note: str = ""


class SegmentParams(BaseModel):
    """Retention model per segment: log r = a + b·age_years + c·log(km + 1000)."""

    model_config = ConfigDict(frozen=True)
    a: float
    b: float
    c: float
    sigma_resid: float  # log-space residual sd of cohort retention around the fit
    sigma_per_year: float  # extra log-sd per year of forecast horizon
    beta_logkm: float  # pooled within-cohort mileage slope (asking price on log km)


class CohortFit(BaseModel):
    model_config = ConfigDict(frozen=True)
    n: int
    ref_km: int
    alpha: float  # log price at ref_km (cohort intercept, after shrinkage)
    beta: float  # shrunk slope on log(km + 1000)
    se_alpha: float
    sigma_car: float
    status: Status
    as_of: date


class VariantParams(BaseModel):
    model_config = ConfigDict(frozen=True)
    segment: str
    shift: float = 0.0  # variant-level retention intercept shift (shrunk)
    new_price_by_year: dict[int, int] = Field(default_factory=dict)  # øre incl. VAT, as sold
    cohorts: dict[int, CohortFit] = Field(default_factory=dict)  # by model year


class MarketModelParams(BaseModel):
    model_config = ConfigDict(frozen=True)
    as_of: date
    version: str  # e.g. "eb-v1"
    segments: dict[str, SegmentParams]
    variants: dict[str, VariantParams]
    dealer_premium: In[Decimal]  # log-points added for dealer sales (δ)
    used_price_drift: In[Decimal]  # annual log-drift in percent, with P10–P90 range
    ask_to_sale_discount: In[Decimal]  # percent; 0 with status estimate until snapshots exist
    status: Status
    note: str = ""


class NewPriceRecord(BaseModel):
    model_config = ConfigDict(frozen=True)
    variant_id: str
    model_year: int
    price_ore: In[int]
    valid_from: date
    valid_to: date | None = None


class EarlyExitRecord(BaseModel):
    model_config = ConfigDict(frozen=True)
    kind: Literal["percent_of_remaining", "fixed_table", "default_estimate"] = "default_estimate"
    percent: In[Decimal] | None = None
    by_month_ore: dict[int, int] | None = None
    recovery_pct: In[Decimal] | None = None


class LeaseOfferRecord(BaseModel):
    model_config = ConfigDict(frozen=True)
    offer_id: str
    variant_id: str
    model_year: int
    term_months: int
    monthly_ore: In[int]
    upfront_ore: In[int]
    fees_ore: In[int]
    km_cap_per_year: In[int]
    excess_km_fee_ore: In[int]
    includes: tuple[Literal["tyres", "service", "insurance"], ...] = ()
    early_exit: EarlyExitRecord = EarlyExitRecord()
    end_of_lease_fee_ore: In[int]
    delivery_months: In[int]
    source: str
    as_of: date
    status: Status


class RatesRecord(BaseModel):
    model_config = ConfigDict(frozen=True)
    as_of: date
    car_loan_rate_pct: In[Decimal]  # market nominal rate with P10–P90 range
    home_ore_per_kwh: In[int]
    public_ore_per_kwh: In[int]
    cpi_index: In[Decimal] | None = None
    policy_rate_pct: In[Decimal] | None = None
    new_car_fees_ore: In[int]  # delivery + registration handling default
    loan_establishment_fee_ore: In[int]
    loan_monthly_fee_ore: In[int]
    dealer_exit_friction_pct: In[Decimal]
    private_exit_friction_pct: In[Decimal]
    dealer_margin_pct: In[Decimal]  # added to cohort value when buying used from a dealer
    new_car_delivery_months: In[int]
    rental_per_month_ore: In[int]
    materiality_threshold: In[Decimal]
