from pydantic import BaseModel, Field, model_validator

from app.schemas.plan import Plan
from app.schemas.types import Amount, ApiModel, Id, Label, Month
from app.timeline import MAX_HORIZON_MONTHS


class IncomeProjectionRequest(BaseModel):
    """`plan_id` uses the signed-in user's saved plan; `plan` projects an explicit hypothetical plan."""

    plan_id: str | None = None
    plan: Plan | None = None
    horizon_months: int = Field(default=60, ge=1, le=MAX_HORIZON_MONTHS)

    @model_validator(mode="after")
    def exactly_one_plan_source(self) -> "IncomeProjectionRequest":
        if (self.plan_id is None) == (self.plan is None):
            raise ValueError("Send either plan_id (a saved plan) or plan (a hypothetical plan), not both or neither.")
        return self


class IncomeYear(ApiModel):
    year: int
    months_included: int
    annual_income: Amount
    cumulative_income: Amount


class IncomeSourceStepUp(ApiModel):
    year: int
    amount: Amount  # in the stream's own frequency


class IncomeSourceYear(ApiModel):
    year: int
    amount: Amount


class IncomeSource(ApiModel):
    """One income stream as entered and as the engine used it. Its yearly amounts add up to the yearly totals."""

    id: Id
    label: Label
    kind: str  # "scheduled" (calendar years, own raise and step-ups) or "legacy" (a monthly figure that follows the plan-wide growth)
    frequency: str
    entered_amount: Amount
    monthly_equivalent: Amount
    start_year: int | None
    end_year: int | None
    ends_after: Month | None
    annual_growth: Amount | None
    growth_start_year: int | None
    effective_growth_annual: Amount  # the yearly raise actually applied (its own, or the plan-wide one for a legacy stream)
    step_ups: list[IncomeSourceStepUp]
    years: list[IncomeSourceYear]


class IncomeProjectionResponse(ApiModel):
    plan_source: str  # "saved" or "hypothetical"
    horizon_months: int
    first_month: str
    total_projected_income: Amount
    plan_growth_annual: Amount  # applies to legacy streams only; scheduled streams never use it
    conventions: list[str]
    years: list[IncomeYear]
    sources: list[IncomeSource]
