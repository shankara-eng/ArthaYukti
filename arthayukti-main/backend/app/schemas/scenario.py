from decimal import Decimal
from typing import Annotated, Literal

from pydantic import Field, model_validator

from app.schemas.types import (
    ApiModel,
    GrowthRate,
    Id,
    Label,
    Money,
    Month,
    Multiplier,
    PositiveMoney,
    Rate,
    SignedMoney,
)
from app.timeline import MAX_HORIZON_MONTHS, month_to_index


class _MonthRange(ApiModel):
    from_month: Month
    to_month: Month

    @model_validator(mode="after")
    def _check_range(self) -> "_MonthRange":
        span = month_to_index(self.to_month) - month_to_index(self.from_month)
        if span < 0:
            raise ValueError("to_month must not be before from_month")
        if span > MAX_HORIZON_MONTHS:
            raise ValueError(f"a range may not exceed {MAX_HORIZON_MONTHS} months")
        return self


class IncomeChange(_MonthRange):
    """Scale income for a month range. A multiplier of 0 models losing the income."""

    type: Literal["income_change"]
    stream_id: Id | None = None  # null applies to every stream
    multiplier: Multiplier


class ExpenseChange(_MonthRange):
    type: Literal["expense_change"]
    delta_monthly: SignedMoney


class OneTimeExpense(ApiModel):
    type: Literal["one_time_expense"]
    month: Month
    amount: PositiveMoney
    label: Label


class OneTimeIncome(ApiModel):
    type: Literal["one_time_income"]
    month: Month
    amount: PositiveMoney
    label: Label


Event = Annotated[
    IncomeChange | ExpenseChange | OneTimeExpense | OneTimeIncome,
    Field(discriminator="type"),
]


class AssumptionOverrides(ApiModel):
    general_inflation_annual: Rate | None = None
    savings_return_annual: Rate | None = None
    income_growth_annual: GrowthRate | None = None
    expense_growth_annual: GrowthRate | None = None


class GoalOverride(ApiModel):
    goal_id: Id
    target_date: Month | None = None
    target_amount_today: PositiveMoney | None = None

    @model_validator(mode="after")
    def _needs_a_change(self) -> "GoalOverride":
        if self.target_date is None and self.target_amount_today is None:
            raise ValueError("a goal override must change target_date or target_amount_today")
        return self


class Scenario(ApiModel):
    """Everything that differs from the plan: shocks, priorities, assumptions, fixes."""

    name: Label = "Scenario"
    events: list[Event] = Field(default_factory=list, max_length=20)
    priority_order: list[Id] | None = None
    assumption_overrides: AssumptionOverrides | None = None
    extra_monthly_savings: Money = Decimal("0.00")
    goal_overrides: list[GoalOverride] = Field(default_factory=list, max_length=8)
