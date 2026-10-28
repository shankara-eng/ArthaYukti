from pydantic import BaseModel, Field, model_validator

from app.schemas.plan import Plan
from app.schemas.types import Amount, ApiModel, Id, Month
from app.timeline import MAX_HORIZON_MONTHS


class ExpenditureProjectionRequest(BaseModel):
    """`plan_id` uses the signed-in user's saved plan; `plan` projects an explicit hypothetical plan."""

    plan_id: str | None = None
    plan: Plan | None = None
    horizon_months: int = Field(default=60, ge=1, le=MAX_HORIZON_MONTHS)

    @model_validator(mode="after")
    def exactly_one_plan_source(self) -> "ExpenditureProjectionRequest":
        if (self.plan_id is None) == (self.plan is None):
            raise ValueError("Send either plan_id (a saved plan) or plan (a hypothetical plan), not both or neither.")
        return self


class ExpenditureYear(ApiModel):
    year: int
    months_included: int
    annual_expenditure: Amount
    cumulative_expenditure: Amount
    essential: Amount
    discretionary: Amount


class ExpenditureLineYear(ApiModel):
    year: int
    amount: Amount


class ExpenditureLine(ApiModel):
    id: Id
    label: str
    category: str | None
    essential: bool
    years: list[ExpenditureLineYear]


class ExpenditureProjectionResponse(ApiModel):
    plan_source: str  # "saved" or "hypothetical"
    horizon_months: int
    first_month: Month
    plan_growth_annual: Amount  # the plan-wide yearly growth used by lines that have no rate of their own
    total_projected_expenditure: Amount
    years: list[ExpenditureYear]
    lines: list[ExpenditureLine]
