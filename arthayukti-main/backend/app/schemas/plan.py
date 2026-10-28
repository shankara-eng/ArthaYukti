from decimal import Decimal
from typing import Annotated, Literal

from pydantic import AfterValidator, Field, model_validator

from app.schemas.types import (
    ApiModel,
    Fraction,
    GrowthRate,
    Id,
    Label,
    Money,
    Month,
    PositiveMoney,
    Rate,
)
from app.timeline import MAX_HORIZON_MONTHS, deadline_index, month_to_index

GoalType = Literal["home", "education", "loan_payoff", "emergency_fund", "retirement", "custom"]


IncomeFrequency = Literal["monthly", "quarterly", "yearly"]
FREQUENCY_MONTHS: dict[str, int] = {"monthly": 1, "quarterly": 3, "yearly": 12}

# Technical safeguards only (request size and validation cost), not product limits.
MAX_INCOME_STREAMS = 200
MAX_EXPENSE_LINES = 60
MAX_STEP_UPS_PER_STREAM = 60
YEAR_MIN, YEAR_MAX = 1990, 2200


class IncomeStepUp(ApiModel):
    """From `year` (January) the stream's base amount is replaced by `amount`, in the stream's frequency."""

    id: Id
    year: int = Field(ge=YEAR_MIN, le=YEAR_MAX)
    amount: PositiveMoney


class IncomeStream(ApiModel):
    """Planned (expected, take-home) income.

    Two forms. A legacy stream has only `monthly_net` and the optional month `ends_after`; the plan-wide
    `income_growth_annual` applies to it exactly as before. A scheduled stream has `start_year` and
    `amount` + `frequency`, an optional inclusive `end_year`, its own optional `annual_growth` (a raise that
    repeats every year), an optional `growth_start_year` (the first calendar year the raise is added) and
    optional `step_ups`; the plan-wide growth is never applied to it. For scheduled streams `monthly_net`
    is derived (the initial amount's monthly equivalent) and any value sent is replaced.
    """

    id: Id
    label: Label
    monthly_net: Money
    ends_after: Month | None = None
    amount: PositiveMoney | None = None
    frequency: IncomeFrequency = "monthly"
    start_year: int | None = Field(default=None, ge=YEAR_MIN, le=YEAR_MAX)
    end_year: int | None = Field(default=None, ge=YEAR_MIN, le=YEAR_MAX)
    annual_growth: Rate | None = None
    growth_start_year: int | None = Field(default=None, ge=YEAR_MIN, le=YEAR_MAX)
    step_ups: list[IncomeStepUp] = Field(default_factory=list, max_length=MAX_STEP_UPS_PER_STREAM)

    @property
    def scheduled(self) -> bool:
        return self.start_year is not None

    @model_validator(mode="after")
    def _check_schedule(self) -> "IncomeStream":
        if self.start_year is None:
            extras = (self.amount, self.end_year, self.annual_growth, self.growth_start_year)
            if any(x is not None for x in extras) or self.step_ups or self.frequency != "monthly":
                raise ValueError(
                    f"income stream {self.id}: amount, frequency, end_year, annual_growth, growth_start_year "
                    "and step_ups need a start_year"
                )
            return self
        if self.amount is None:
            raise ValueError(f"income stream {self.id}: a scheduled stream needs an amount")
        if self.ends_after is not None:
            raise ValueError(f"income stream {self.id}: use end_year, not ends_after, with start_year")
        if self.end_year is not None and self.end_year < self.start_year:
            raise ValueError(f"income stream {self.id}: end_year is before start_year")
        if self.growth_start_year is not None:
            if self.annual_growth is None:
                raise ValueError(f"income stream {self.id}: a raise start year needs an annual raise")
            if self.growth_start_year <= self.start_year:
                raise ValueError(
                    f"income stream {self.id}: the raise must start after the start year "
                    "(the amount entered is what is earned in the start year)"
                )
            if self.end_year is not None and self.growth_start_year > self.end_year:
                raise ValueError(f"income stream {self.id}: the raise starts after the end year")
        years = [step.year for step in self.step_ups]
        if len(set(years)) != len(years):
            raise ValueError(f"income stream {self.id}: only one step-up is allowed per year")
        if len({step.id for step in self.step_ups}) != len(self.step_ups):
            raise ValueError(f"income stream {self.id}: step-up ids must be unique")
        for step in self.step_ups:
            if step.year <= self.start_year:
                raise ValueError(
                    f"income stream {self.id}: a step-up must be after the start year "
                    f"(the initial amount defines the start)"
                )
            if self.end_year is not None and step.year > self.end_year:
                raise ValueError(f"income stream {self.id}: a step-up falls after the end year")
        self.monthly_net = monthly_equivalent(self.amount, self.frequency)
        return self


def _needs_goals(plan: "Plan") -> "Plan":
    if not plan.goals:
        raise ValueError("Add at least one goal before this can be worked out.")
    return plan


def monthly_equivalent(amount: Decimal, frequency: str) -> Decimal:
    """The initial amount per month, rounded half-up to the paisa (display and legacy consumers only).

    The engine itself divides without rounding and rounds each projected month once.
    """
    return (amount / FREQUENCY_MONTHS[frequency]).quantize(Decimal("0.01"), rounding="ROUND_HALF_UP")


class Expense(ApiModel):
    """A spending line.

    A plain line has only `monthly` and behaves exactly as before: the plan-wide `expense_growth_annual` steps
    it up once every 12 months from the plan's first month. Optional fields make it a schedule:

    - `annual_growth` gives this line its own yearly growth instead of the plan-wide rate (a line can have one
      without any other schedule field).
    - `start_month` turns the line into a scheduled one with an `amount` in a `frequency` (monthly, quarterly or
      yearly), an optional inclusive `end_month` (blank means ongoing) and optional `category`. `monthly` is then
      derived (the amount's monthly equivalent) and any value sent is replaced.

    A scheduled amount is spread evenly over its frequency, like income. It is the amount paid from the later of
    its start month and the plan's first month, and grows once every 12 months after that.
    """

    id: Id
    label: Label
    monthly: Money
    # Protected by default. Only expenses marked False can be trimmed by the rescue engine.
    essential: bool = True
    category: Label | None = None
    amount: PositiveMoney | None = None
    frequency: IncomeFrequency | None = None  # absent means monthly
    start_month: Month | None = None
    end_month: Month | None = None
    annual_growth: GrowthRate | None = None

    @model_validator(mode="after")
    def _check_schedule(self) -> "Expense":
        if self.start_month is None:
            if self.amount is not None or self.end_month is not None or self.frequency not in (None, "monthly"):
                raise ValueError(f"expense {self.id}: amount, frequency and end_month need a start_month")
            return self
        if self.amount is None:
            raise ValueError(f"expense {self.id}: a scheduled expense needs an amount")
        if self.end_month is not None and month_to_index(self.end_month) < month_to_index(self.start_month):
            raise ValueError(f"expense {self.id}: end_month is before start_month")
        self.monthly = monthly_equivalent(self.amount, self.frequency or "monthly")
        return self


class Commitment(ApiModel):
    """An existing fixed payment (for example an EMI) that stops after remaining_months."""

    id: Id
    label: Label
    monthly_payment: Money
    remaining_months: int = Field(ge=1, le=MAX_HORIZON_MONTHS)


class Flexibility(ApiModel):
    max_delay_months: int = Field(default=24, ge=0, le=120)
    min_target_pct: Fraction = Field(default=Decimal("0.80"), ge=Decimal("0.50"), le=1)


class Goal(ApiModel):
    id: Id
    label: Label
    type: GoalType
    target_amount_today: PositiveMoney
    target_date: Month
    priority: int = Field(ge=1, le=8)
    inflation_linked: bool
    inflation_rate_override: Rate | None = None
    current_savings: Money = Decimal("0.00")
    flexibility: Flexibility = Field(default_factory=Flexibility)


class Assumptions(ApiModel):
    """Every rate is an explicit input. Annual, nominal, compounded monthly."""

    general_inflation_annual: Rate
    savings_return_annual: Rate
    income_growth_annual: GrowthRate
    expense_growth_annual: GrowthRate


class FixLimits(ApiModel):
    extra_savings_cap_pct_of_income: Fraction = Decimal("0.20")


class SpendingMonth(ApiModel):
    """What the person's Expenditure plans say they spend in one month."""

    month: Month
    amount: Money


class Plan(ApiModel):
    name: Label
    as_of: Month
    currency: Literal["INR"]
    income_streams: list[IncomeStream] = Field(min_length=1, max_length=MAX_INCOME_STREAMS)
    expenses: list[Expense] = Field(default_factory=list, max_length=MAX_EXPENSE_LINES)
    commitments: list[Commitment] = Field(default_factory=list, max_length=6)
    unassigned_savings: Money = Decimal("0.00")
    # A plan can be saved before any goal exists (income and spending come first); projecting it needs one.
    goals: list[Goal] = Field(max_length=8)
    assumptions: Assumptions
    fix_limits: FixLimits = Field(default_factory=FixLimits)
    # Month-by-month spending taken from the Expenditure plans (see POST /expenditure/apply-to-plan). For a month it
    # covers, it is the spending and the expense lines are not added; any other month uses the expense lines.
    spending_schedule: list[SpendingMonth] = Field(default_factory=list, max_length=MAX_HORIZON_MONTHS)

    @model_validator(mode="after")
    def _check_consistency(self) -> "Plan":
        _require_unique("income stream", [s.id for s in self.income_streams])
        _require_unique("expense", [e.id for e in self.expenses])
        _require_unique("commitment", [c.id for c in self.commitments])
        _require_unique("goal", [g.id for g in self.goals])
        _require_unique("spending month", [s.month for s in self.spending_schedule])

        priorities = sorted(g.priority for g in self.goals)
        if priorities != list(range(1, len(self.goals) + 1)):
            raise ValueError("goal priorities must be unique and run 1..n with no gaps")

        as_of_index = month_to_index(self.as_of)
        for goal in self.goals:
            deadline = deadline_index(self.as_of, goal.target_date)
            if deadline < 1:
                raise ValueError(f"goal {goal.id}: target_date must not be before as_of")
            if deadline > MAX_HORIZON_MONTHS:
                raise ValueError(
                    f"goal {goal.id}: target_date is more than {MAX_HORIZON_MONTHS} months away"
                )
        for stream in self.income_streams:
            if stream.ends_after is not None and month_to_index(stream.ends_after) < as_of_index:
                raise ValueError(f"income stream {stream.id}: ends_after is before as_of")
            if stream.start_year is not None and stream.start_year < int(self.as_of[:4]):
                raise ValueError(f"income stream {stream.id}: start_year is in the past")
            if stream.end_year is not None and stream.end_year < int(self.as_of[:4]):
                raise ValueError(f"income stream {stream.id}: end_year is in the past")
        return self


def _require_unique(kind: str, ids: list[str]) -> None:
    if len(set(ids)) != len(ids):
        raise ValueError(f"{kind} ids must be unique")


# What the goal-based calculations take: a plan with at least one goal, checked at the request.
PlanWithGoals = Annotated[Plan, AfterValidator(_needs_goals)]
