from typing import Literal

from pydantic import Field

from app.schemas.scenario import Scenario
from app.schemas.types import Amount, ApiModel, Id, Month

GoalStatus = Literal["on_track", "delayed", "not_achievable"]


class PlanWarning(ApiModel):
    code: str
    message: str
    month: Month | None = None


class CrowdedOut(ApiModel):
    """Money that went to a higher-ranked goal while this goal received less than required."""

    goal_id: Id
    amount: Amount


class GoalOutcome(ApiModel):
    goal_id: Id
    label: str
    status: GoalStatus
    target_date: Month
    target_amount_today: Amount
    inflated_target_at_deadline: Amount
    balance_at_deadline: Amount
    shortfall_at_deadline_nominal: Amount
    shortfall_at_deadline_today: Amount
    required_monthly_level_standalone: Amount
    projected_completion: Month | None
    delay_months: int | None
    average_monthly_contribution: Amount
    total_contributed: Amount
    total_withdrawn: Amount
    crowded_out_by: list[CrowdedOut]


class ProjectionSummary(ApiModel):
    goals_total: int
    on_track: int
    delayed: int
    not_achievable: int
    plan_feasible: bool
    uncovered_deficit_months: list[Month]
    overcommitment_ratio: Amount | None
    total_shortfall_today: Amount


class MonthGoalRow(ApiModel):
    goal_id: Id
    contribution: Amount
    withdrawal: Amount
    growth: Amount
    balance: Amount
    required: Amount
    inflated_target: Amount
    realised: bool


class MonthRow(ApiModel):
    month: Month
    income: Amount
    expenses: Amount
    commitments: Amount
    one_offs: Amount
    surplus: Amount
    free_cash: Amount
    uncovered_deficit: Amount
    goals: list[MonthGoalRow]


class ProjectionResult(ApiModel):
    as_of: Month
    horizon_months: int
    summary: ProjectionSummary
    goals: list[GoalOutcome]
    monthly: list[MonthRow] = Field(default_factory=list)
    warnings: list[PlanWarning] = Field(default_factory=list)


# Trade-off matrix


class TradeoffOutcome(ApiModel):
    goal_id: Id
    status: GoalStatus
    delay_months: int | None
    shortfall_today: Amount


class TradeoffTotals(ApiModel):
    goals_missed: int
    total_delay_months: int
    total_shortfall_today: Amount


class TradeoffRow(ApiModel):
    prioritised_goal_id: Id
    priority_order: list[Id]
    outcomes: list[TradeoffOutcome]
    totals: TradeoffTotals


class TradeoffResult(ApiModel):
    baseline: ProjectionSummary
    rows: list[TradeoffRow]


# Minimal fixes

FixLever = Literal["extra_savings", "delay_goal", "reduce_target"]
FixUnit = Literal["rupees_per_month", "months", "percent"]


class FixOption(ApiModel):
    id: str
    lever: FixLever
    goal_id: Id | None
    magnitude: Amount
    unit: FixUnit
    normalised_cost: Amount
    resolves: list[Id]
    leaves_unresolved: list[Id]
    scenario_delta: Scenario
    result_summary: ProjectionSummary


class FixResult(ApiModel):
    needs_fix: bool
    options: list[FixOption]
    recommended_option_id: str | None
    no_single_fix_reason: str | None


# Comparison


class CompareEntry(ApiModel):
    scenario_name: str
    summary: ProjectionSummary
    goals: list[GoalOutcome]


class CompareDiff(ApiModel):
    """Change for one goal relative to the first scenario in the request."""

    scenario_name: str
    goal_id: Id
    completion_shift_months: int | None
    shortfall_change_today: Amount


class CompareResult(ApiModel):
    results: list[CompareEntry]
    diffs: list[CompareDiff]
