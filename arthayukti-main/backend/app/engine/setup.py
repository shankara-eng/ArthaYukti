"""Turn a plan plus an optional scenario into the resolved inputs the engine simulates."""

from dataclasses import dataclass, field
from decimal import Decimal

from app.engine.income import stream_tables
from app.schemas.plan import Commitment, Expense, IncomeStream, Plan
from app.schemas.results import PlanWarning
from app.schemas.scenario import (
    ExpenseChange,
    IncomeChange,
    OneTimeExpense,
    OneTimeIncome,
    Scenario,
)
from app.timeline import MAX_HORIZON_MONTHS, deadline_index, index_to_month, month_to_index

EXTRA_HORIZON_MONTHS = 240  # simulate 20 years past the latest deadline, capped at 600 months


@dataclass(frozen=True)
class GoalSpec:
    id: str
    label: str
    type: str
    priority: int
    target_today: Decimal
    deadline: int  # contribution months up to and including the target month
    annual_inflation: Decimal  # already 0 for goals that are not inflation-linked
    saved: Decimal
    revolving: bool  # emergency funds are topped up and drawn on, never locked


@dataclass(frozen=True)
class IncomeCut:
    from_t: int
    to_t: int
    stream_id: str | None
    multiplier: Decimal


@dataclass(frozen=True)
class ExpenseShift:
    from_t: int
    to_t: int
    delta: Decimal


@dataclass
class Resolved:
    as_of: str
    as_of_index: int
    horizon: int
    goals: list[GoalSpec]  # sorted by (priority, id)
    return_annual: Decimal
    income_growth: Decimal
    expense_growth: Decimal
    streams: list[IncomeStream]
    expenses: list[Expense]
    commitments: list[Commitment]
    unassigned: Decimal
    extra_monthly: Decimal
    income_cuts: list[IncomeCut]
    expense_shifts: list[ExpenseShift]
    one_offs: dict[int, Decimal]  # net amount by month index t
    warnings: list[PlanWarning] = field(default_factory=list)
    # Scheduled income streams: unrounded monthly-equivalent base by calendar year (see engine/income.py)
    stream_bases: dict[str, dict[int, Decimal]] = field(default_factory=dict)
    # When set, the month's base spending (by plan month t) comes from here instead of the plan's expense lines.
    spending_override: dict[int, Decimal] | None = None

    def month_label(self, t: int) -> str:
        return index_to_month(self.as_of_index + t - 1)


def resolve(plan: Plan, scenario: Scenario | None) -> Resolved:
    scenario = scenario or Scenario()
    assumptions = plan.assumptions
    if scenario.assumption_overrides is not None:
        changes = {
            key: value
            for key, value in scenario.assumption_overrides.model_dump().items()
            if value is not None
        }
        assumptions = assumptions.model_copy(update=changes)

    goal_ids = [goal.id for goal in plan.goals]
    if scenario.priority_order is not None:
        if sorted(scenario.priority_order) != sorted(goal_ids):
            raise ValueError("priority_order must list every goal exactly once")
        rank = {goal_id: index + 1 for index, goal_id in enumerate(scenario.priority_order)}
    else:
        rank = {goal.id: goal.priority for goal in plan.goals}

    overrides = {override.goal_id: override for override in scenario.goal_overrides}
    unknown = set(overrides) - set(goal_ids)
    if unknown:
        raise ValueError(f"goal_overrides names unknown goals: {sorted(unknown)}")

    goals: list[GoalSpec] = []
    for goal in plan.goals:
        override = overrides.get(goal.id)
        target_date = goal.target_date
        target_today = goal.target_amount_today
        if override is not None:
            if override.target_date is not None:
                target_date = override.target_date
            if override.target_amount_today is not None:
                target_today = override.target_amount_today
        deadline = deadline_index(plan.as_of, target_date)
        if deadline < 1:
            raise ValueError(f"goal {goal.id}: target_date must not be before as_of")
        if deadline > MAX_HORIZON_MONTHS:
            raise ValueError(f"goal {goal.id}: target_date is too far away")
        if goal.inflation_linked:
            inflation = (
                goal.inflation_rate_override
                if goal.inflation_rate_override is not None
                else assumptions.general_inflation_annual
            )
        else:
            inflation = Decimal(0)
        goals.append(
            GoalSpec(
                id=goal.id,
                label=goal.label,
                type=goal.type,
                priority=rank[goal.id],
                target_today=target_today,
                deadline=deadline,
                annual_inflation=inflation,
                saved=goal.current_savings,
                revolving=goal.type == "emergency_fund",
            )
        )
    goals.sort(key=lambda spec: (spec.priority, spec.id))

    as_of_index = month_to_index(plan.as_of)
    horizon = min(MAX_HORIZON_MONTHS, max((spec.deadline for spec in goals), default=0) + EXTRA_HORIZON_MONTHS)

    def to_t(month: str) -> int:
        return month_to_index(month) - as_of_index + 1

    stream_ids = {stream.id for stream in plan.income_streams}
    warnings: list[PlanWarning] = []
    income_cuts: list[IncomeCut] = []
    expense_shifts: list[ExpenseShift] = []
    one_offs: dict[int, Decimal] = {}

    def note_outside(label: str, first: int, last: int) -> None:
        if last < 1 or first > horizon:
            warnings.append(
                PlanWarning(
                    code="event_outside_plan",
                    message=f"{label} falls outside the plan and has no effect.",
                )
            )

    for event in scenario.events:
        if isinstance(event, IncomeChange):
            if event.stream_id is not None and event.stream_id not in stream_ids:
                raise ValueError(f"income_change names an unknown income stream: {event.stream_id}")
            cut = IncomeCut(
                to_t(event.from_month), to_t(event.to_month), event.stream_id, event.multiplier
            )
            note_outside("An income change", cut.from_t, cut.to_t)
            income_cuts.append(cut)
        elif isinstance(event, ExpenseChange):
            shift = ExpenseShift(to_t(event.from_month), to_t(event.to_month), event.delta_monthly)
            note_outside("An expense change", shift.from_t, shift.to_t)
            expense_shifts.append(shift)
        elif isinstance(event, OneTimeExpense | OneTimeIncome):
            t = to_t(event.month)
            note_outside(f"The one-time item {event.label!r}", t, t)
            sign = Decimal(-1) if isinstance(event, OneTimeExpense) else Decimal(1)
            one_offs[t] = one_offs.get(t, Decimal(0)) + sign * event.amount

    schedule = {
        month_to_index(item.month) - as_of_index + 1: item.amount for item in plan.spending_schedule
    }
    schedule = {t: amount for t, amount in schedule.items() if 1 <= t <= horizon}
    if plan.spending_schedule and any(t not in schedule for t in range(1, horizon + 1)):
        warnings.append(
            PlanWarning(
                code="spending_schedule_short",
                message="The spending taken from your Expenditure plans does not cover every month. Months it leaves out use your plan's expense lines.",
            )
        )
    return Resolved(
        as_of=plan.as_of,
        as_of_index=as_of_index,
        horizon=horizon,
        goals=goals,
        return_annual=assumptions.savings_return_annual,
        income_growth=assumptions.income_growth_annual,
        expense_growth=assumptions.expense_growth_annual,
        streams=list(plan.income_streams),
        expenses=list(plan.expenses),
        commitments=list(plan.commitments),
        unassigned=plan.unassigned_savings,
        extra_monthly=scenario.extra_monthly_savings,
        income_cuts=income_cuts,
        expense_shifts=expense_shifts,
        one_offs=one_offs,
        warnings=warnings,
        stream_bases=stream_tables(plan.income_streams, as_of_index),
        spending_override=schedule or None,
    )
