"""The emergency-fund view: what is held, what the target is, and how the engine grows the reserve."""

from pydantic import Field

from app.schemas.plan import MAX_EXPENSE_LINES, Commitment, Expense, Plan
from app.schemas.types import Amount, ApiModel, Fraction, Id, Month


class EmergencyRequest(ApiModel):
    # A full plan, when it has goals (needed for the projection). Before any goal exists there is no valid plan,
    # so the spending can be sent on its own and only the essentials are worked out.
    plan: Plan | None = None
    expenses: list[Expense] = Field(default_factory=list, max_length=MAX_EXPENSE_LINES)
    as_of: Month | None = None  # lets scheduled lines that are not running yet be left out of today's essentials
    commitments: list[Commitment] = Field(default_factory=list, max_length=6)
    # The person's own target, in months of essential spending. Omitted means they have not set one.
    target_months: int | None = Field(default=None, ge=1, le=60)


class ReservePoint(ApiModel):
    month: Month
    balance: Amount


class EmergencyAnalysis(ApiModel):
    monthly_essentials: Amount  # essential spending plus fixed loan payments
    target_months: int | None
    target_amount: Amount | None  # target_months x monthly_essentials
    has_goal: bool
    goal_id: Id | None
    goal_label: str | None
    goal_target_today: Amount | None  # the target the emergency-fund goal itself carries, if any
    reserve_held: Amount | None  # the goal's saved balance, counted once; None when no goal tracks it
    months_covered: str | None  # reserve_held / monthly_essentials, one decimal
    progress: Fraction | None  # reserve_held / target_amount, capped at 1
    shortfall_to_target: Amount | None
    projected: list[ReservePoint]  # the engine's month-by-month reserve balance (first 24 months)
    goal_status: str | None
    projected_completion: Month | None
    notes: list[str]
