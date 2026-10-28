"""Investment calculators: request and response shapes.

Amounts and rates are decimal strings on the wire. Rates are fractions (0.12 = 12%), nominal annual and
compounded monthly (rate / 12), the same convention as the rest of the product.
"""

from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.schemas.types import (
    Amount,
    ApiModel,
    DecimalStr,
    Id,
    Label,
    Money,
    Month,
    PositiveMoney,
)

MAX_YEARS = 60
MAX_INVESTMENTS = 20
MAX_STEP_UPS = 10
MAX_COMPARE = 4
MAX_SAVED_SCENARIOS = 50
MAX_VALUATION_MONTHS = 1200

# A calculator rate may be negative, down to a total loss each year (-100%).
CalcRate = Annotated[
    DecimalStr, Field(ge=Decimal("-1"), le=Decimal("1"), max_digits=9, decimal_places=6)
]
TaxRate = Annotated[DecimalStr, Field(ge=0, le=1, max_digits=8, decimal_places=4)]
InflationRate = Annotated[
    DecimalStr, Field(ge=0, le=Decimal("0.50"), max_digits=8, decimal_places=6)
]
StepUpPercent = Annotated[DecimalStr, Field(ge=0, le=Decimal("10"), max_digits=8, decimal_places=4)]

Frequency = Literal["monthly", "quarterly", "annual"]
Mode = Literal["individual", "common_date"]


class CalcStepUp(BaseModel):
    """From investment year `from_year` (year 1 = the first 12 months), the instalment changes.

    `amount` sets the new instalment; `percent` raises the previous instalment by that fraction (0.10 = +10%).
    """

    model_config = ConfigDict(extra="forbid")

    from_year: int = Field(ge=2, le=MAX_YEARS)
    mode: Literal["amount", "percent"] = "amount"
    amount: PositiveMoney | None = None
    percent: StepUpPercent | None = None

    @model_validator(mode="after")
    def matching_value(self) -> "CalcStepUp":
        if self.mode == "amount" and self.amount is None:
            raise ValueError("An amount step-up needs `amount`.")
        if self.mode == "percent" and self.percent is None:
            raise ValueError("A percent step-up needs `percent`.")
        return self


class CalcSip(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: PositiveMoney  # one instalment (per month, quarter or year, as `frequency` says)
    frequency: Frequency = "monthly"
    contribution_years: int = Field(ge=1, le=MAX_YEARS)
    step_ups: list[CalcStepUp] = Field(default_factory=list, max_length=MAX_STEP_UPS)

    @model_validator(mode="after")
    def valid_step_ups(self) -> "CalcSip":
        years = [step.from_year for step in self.step_ups]
        if len(set(years)) != len(years):
            raise ValueError("Two step-ups cannot start in the same year.")
        if any(year > self.contribution_years for year in years):
            raise ValueError("A step-up cannot start after contributions have stopped.")
        return self


class CalcAfterMaturity(BaseModel):
    """What happens to a balance whose growth period ends before the common valuation date."""

    model_config = ConfigDict(extra="forbid")

    action: Literal["hold", "continue", "reinvest"]
    rate: CalcRate | None = None  # only for `reinvest`

    @model_validator(mode="after")
    def rate_only_for_reinvest(self) -> "CalcAfterMaturity":
        if self.action == "reinvest" and self.rate is None:
            raise ValueError("Reinvesting needs `rate`.")
        if self.action != "reinvest" and self.rate is not None:
            raise ValueError("`rate` applies only when the action is `reinvest`.")
        return self


class CalcInvestment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Id
    name: Label
    start_month: Month  # the investment begins at the start of this month
    lump_sum: Money = Decimal("0.00")  # invested on the first day
    sip: CalcSip | None = None
    growth_years: int = Field(
        ge=1, le=MAX_YEARS
    )  # total period money keeps growing, from the start
    annual_growth: CalcRate
    tax_rate: TaxRate = Decimal("0")  # applied once, at the valuation date
    # gains: tax on the positive gain over the principal paid in. total_amount: tax on the whole (non-negative) value.
    tax_method: Literal["gains", "total_amount"] = "gains"
    # nominal_monthly: the rate is a nominal annual rate compounded monthly (rate / 12), the product's convention.
    # effective_annual: the rate is the effective annual rate, so a month is (1 + rate)^(1/12) - 1 and inflation
    # divides by (1 + inflation)^(years). It applies to growth, an after-maturity reinvestment rate and inflation.
    rate_convention: Literal["nominal_monthly", "effective_annual"] = "nominal_monthly"
    inflation_rate: InflationRate = Decimal("0")
    after_maturity: CalcAfterMaturity | None = None

    @model_validator(mode="after")
    def valid_periods(self) -> "CalcInvestment":
        if self.lump_sum <= 0 and self.sip is None:
            raise ValueError("Add a lump sum, a recurring investment, or both.")
        if self.sip is not None and self.sip.contribution_years > self.growth_years:
            raise ValueError("Contributions cannot continue past the end of the growth period.")
        return self


class CalculatorConfig(BaseModel):
    """One calculator state. `mode` picks how every investment is valued."""

    model_config = ConfigDict(extra="forbid")

    mode: Mode = "individual"
    common_date: Month | None = None  # valued at the end of this month
    investments: list[CalcInvestment] = Field(min_length=1, max_length=MAX_INVESTMENTS)
    compile_ids: list[Id] | None = None  # investments in the compiled report; None means all

    @model_validator(mode="after")
    def consistent(self) -> "CalculatorConfig":
        ids = [item.id for item in self.investments]
        if len(set(ids)) != len(ids):
            raise ValueError("Investment ids must be unique, so nothing is counted twice.")
        if self.mode == "common_date" and self.common_date is None:
            raise ValueError("Common-date mode needs `common_date`.")
        if self.mode == "individual" and self.common_date is not None:
            raise ValueError("`common_date` applies only in common-date mode.")
        if self.compile_ids is not None:
            if len(set(self.compile_ids)) != len(self.compile_ids):
                raise ValueError("compile_ids lists an investment twice.")
            unknown = [item for item in self.compile_ids if item not in ids]
            if unknown:
                raise ValueError(
                    f"compile_ids names investments that are not in this calculator: {', '.join(unknown)}."
                )
        return self


# ---- results -------------------------------------------------------------------------------------------


class CalcAnnualRow(ApiModel):
    year: int  # investment year, 1-based
    from_month: Month
    to_month: Month
    months: int
    phase: Literal["contributing", "growth_only", "after_maturity"]
    instalment: Amount  # the instalment in force this year (0.00 once contributions stop)
    instalments: int
    opening: Amount
    contributions: Amount  # includes the lump sum in year 1
    growth: Amount  # closing - opening - contributions (a loss is negative)
    closing: Amount
    cumulative_invested: Amount
    cumulative_gain: Amount
    inflation_adjusted_closing: Amount  # before tax; the tax is taken once, at the valuation date


class CalcInvestmentResult(ApiModel):
    id: str
    name: str
    status: Literal["not_started", "before_maturity", "at_maturity", "after_maturity"]
    start_month: Month
    valuation_month: Month | None
    months_valued: int
    principal: Amount
    value: Amount
    gain: Amount  # value - principal; negative for a loss
    tax: Amount
    post_tax_value: Amount
    inflation_adjusted_value: (
        Amount  # post-tax, in the money of the start (individual) or base month (common)
    )
    contributions_made: int
    annual: list[CalcAnnualRow]


class CalcAggregate(ApiModel):
    included: int  # investments that had started by the valuation date
    principal: Amount
    value: Amount
    gain: Amount  # net of gains and losses
    total_gains: Amount
    total_losses: Amount  # a positive number
    tax: Amount
    post_tax_value: Amount
    inflation_adjusted_value: (
        Amount | None
    )  # only meaningful when everything shares one valuation date
    mixed_valuation_dates: (
        bool  # True when investments are valued at different dates (individual mode)
    )


class CalcCompiledYear(ApiModel):
    year: int  # calendar year
    contributions: Amount
    closing_active: Amount  # balances still growing at the end of the year
    matured_held: Amount  # balances whose valuation had already ended, held at their final value
    closing_total: Amount
    cumulative_invested: Amount
    cumulative_gain: Amount


class CalcCompilation(ApiModel):
    investment_ids: list[str]
    aggregate: CalcAggregate
    years: list[CalcCompiledYear]


class CalculatorResult(ApiModel):
    mode: Mode
    common_date: Month | None
    investments: list[CalcInvestmentResult]
    aggregate: CalcAggregate
    compilation: CalcCompilation


class MaturityDecisionNeeded(ApiModel):
    investment_id: str
    name: str
    matures: Month  # the last month of its growth period


# ---- scenarios -----------------------------------------------------------------------------------------

ScenarioName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class CalcScenarioIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ScenarioName
    config: CalculatorConfig


class CalcScenarioOut(ApiModel):
    id: str
    name: str
    config: CalculatorConfig
    created_at: str
    updated_at: str


class CalcScenarioSummary(ApiModel):
    id: str
    name: str
    investments: int
    mode: Mode
    updated_at: str


class CalcCompareEntry(BaseModel):
    """A saved scenario (`scenario_id`) or an unsaved calculator (`config`), with a label."""

    model_config = ConfigDict(extra="forbid")

    scenario_id: str | None = None
    config: CalculatorConfig | None = None
    label: Label | None = None

    @model_validator(mode="after")
    def one_source(self) -> "CalcCompareEntry":
        if (self.scenario_id is None) == (self.config is None):
            raise ValueError("Send either scenario_id or config, not both or neither.")
        return self


class CalcCompareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entries: list[CalcCompareEntry] = Field(min_length=2, max_length=MAX_COMPARE)
    common_date: Month | None = None  # when set, every entry is valued at this one date


class CalcCompareRow(ApiModel):
    label: str
    scenario_id: str | None
    mode: Mode
    common_date: Month | None
    aggregate: CalcAggregate
    delta_post_tax_vs_first: Amount


class CalcCompareResponse(ApiModel):
    rows: list[CalcCompareRow]
