from decimal import Decimal

from pydantic import Field

from app.schemas.types import (
    Amount,
    ApiModel,
    DecimalStr,
    Money,
    Rate,
)


class SipYearlyMilestone(ApiModel):
    year: int
    monthly_sip_amount: Amount
    total_invested_to_date: Amount
    estimated_returns_to_date: Amount
    total_corpus: Amount


class SipProjectionRequest(ApiModel):
    monthly_investment: Money
    annual_expected_return: Rate
    tenure_years: int = Field(ge=1, le=50)
    initial_investment: Money = Field(default=Decimal("0.00"))
    step_up_percentage: Rate = Field(default=Decimal("0.00"))
    step_up_amount: Money = Field(default=Decimal("0.00"))
    step_up_frequency_months: int = Field(default=12, ge=1, le=60)


class SipProjectionResponse(ApiModel):
    initial_investment: Amount
    starting_monthly_sip: Amount
    final_monthly_sip: Amount
    total_invested: Amount
    estimated_returns: Amount
    final_wealth: Amount
    wealth_multiplier: DecimalStr
    tenure_years: int
    yearly_milestones: list[SipYearlyMilestone]
