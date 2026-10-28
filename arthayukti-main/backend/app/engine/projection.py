"""Projection engine (docs/FINANCIAL_MODEL.md).

Pure functions over Decimal. No randomness, no floats, stable ordering.
"""

from dataclasses import dataclass, field
from decimal import Decimal

from app.engine.flows import month_flows
from app.engine.money import ZERO, ceil_paise, engine_context, quantize
from app.engine.setup import GoalSpec, Resolved, resolve
from app.schemas.plan import Plan
from app.schemas.results import (
    CrowdedOut,
    GoalOutcome,
    MonthGoalRow,
    MonthRow,
    PlanWarning,
    ProjectionResult,
    ProjectionSummary,
)
from app.schemas.scenario import Scenario


def inflated_target(target_today: Decimal, annual_rate: Decimal, months: int) -> Decimal:
    """Nominal target after `months`: round(target_today * (1 + annual_rate / 12) ** months)."""
    with engine_context():
        return quantize(target_today * (1 + annual_rate / 12) ** months)


def monthly_surplus_series(plan: Plan, scenario: Scenario | None, months: int) -> list[Decimal]:
    """Surplus S_t for months 1..months, after growth steps, commitments and shocks."""
    with engine_context():
        resolved = resolve(plan, scenario)
        return [month_flows(resolved, t).surplus for t in range(1, months + 1)]


def project(
    plan: Plan, scenario: Scenario | None = None, include_monthly: bool = True
) -> ProjectionResult:
    """Run the monthly allocation policy and report per-goal outcomes."""
    if not plan.goals:
        raise ValueError("Add at least one goal before the plan can be projected.")
    with engine_context():
        return _project(resolve(plan, scenario), include_monthly)


def project_resolved(resolved: Resolved, include_monthly: bool = True) -> ProjectionResult:
    """Run the same allocation policy on inputs that are already resolved.

    For callers that add monthly flows the plan cannot express (the financial trajectory's loan payments and
    premiums) before running the goal engine. `project` is this plus `resolve`."""
    with engine_context():
        return _project(resolved, include_monthly)


@dataclass
class _Goal:
    spec: GoalSpec
    targets: list[Decimal]  # nominal target N_t for t = 0..horizon
    balance: Decimal
    realised: bool = False
    first_reached_t: int | None = None
    reached_after_deadline_t: int | None = None
    contributed: Decimal = ZERO
    withdrawn: Decimal = ZERO
    balance_at_deadline: Decimal = ZERO
    crowded_by: dict[str, Decimal] = field(default_factory=dict)

    @property
    def id(self) -> str:
        return self.spec.id


def _required(goal: _Goal, t: int, monthly_return: Decimal) -> Decimal:
    """Level monthly amount that reaches the deadline target (pass 1 of the policy)."""
    spec = goal.spec
    remaining_months = spec.deadline - t + 1
    if remaining_months < 1:
        return ceil_paise(max(Decimal(0), goal.targets[t] - goal.balance))
    target = goal.targets[spec.deadline]
    if monthly_return == 0:
        future_value, annuity = goal.balance, Decimal(remaining_months)
    else:
        growth = 1 + monthly_return
        future_value = goal.balance * growth ** (remaining_months - 1)
        annuity = (growth**remaining_months - 1) / monthly_return
    return ceil_paise(max(Decimal(0), (target - future_value) / annuity))


def _standalone_required(goal: _Goal, monthly_return: Decimal) -> Decimal:
    """Level monthly amount from the plan start if this goal had the whole surplus."""
    spec = goal.spec
    target = goal.targets[spec.deadline]
    if monthly_return == 0:
        future_value, annuity = spec.saved, Decimal(spec.deadline)
    else:
        growth = 1 + monthly_return
        future_value = spec.saved * growth**spec.deadline
        annuity = (growth**spec.deadline - 1) / monthly_return
    return ceil_paise(max(Decimal(0), (target - future_value) / annuity))


def _project(resolved: Resolved, include_monthly: bool) -> ProjectionResult:
    horizon = resolved.horizon
    monthly_return = resolved.return_annual / 12

    goals = [
        _Goal(
            spec=spec,
            targets=[
                quantize(spec.target_today * (1 + spec.annual_inflation / 12) ** t)
                for t in range(horizon + 1)
            ],
            balance=spec.saved,
        )
        for spec in resolved.goals
    ]
    emergency = [g for g in goals if g.spec.revolving]
    others_lowest_first = [g for g in reversed(goals) if not g.spec.revolving]

    free_cash = ZERO
    uncovered_months: list[int] = []
    uncovered_total = ZERO
    first_surplus = ZERO
    rows: list[MonthRow] = []

    for t in range(1, horizon + 1):
        flows = month_flows(resolved, t)
        surplus = flows.surplus
        if t == 1:
            first_surplus = surplus

        growth: dict[str, Decimal] = {}
        for goal in goals:
            if goal.realised:
                growth[goal.id] = ZERO
                continue
            interest = quantize(goal.balance * monthly_return)
            goal.balance += interest
            growth[goal.id] = interest

        if t == 1:
            pool = resolved.unassigned
            for goal in goals:
                amount = min(pool, max(ZERO, goal.targets[1] - goal.balance))
                goal.balance += amount
                pool -= amount
            free_cash += pool

        contribution = {g.id: ZERO for g in goals}
        withdrawal = {g.id: ZERO for g in goals}
        required = {g.id: ZERO for g in goals}
        uncovered = ZERO

        if surplus >= 0:
            remaining = surplus
            active = [g for g in goals if not g.realised]
            for goal in active:
                required[goal.id] = _required(goal, t, monthly_return)
                need = max(ZERO, goal.targets[t] - goal.balance)
                pay = min(required[goal.id], need, remaining)
                goal.balance += pay
                goal.contributed += pay
                contribution[goal.id] += pay
                remaining -= pay
            for goal in active:
                unmet = required[goal.id] - contribution[goal.id]
                if unmet > 0:
                    for higher in active:
                        if (
                            higher.spec.priority < goal.spec.priority
                            and contribution[higher.id] > 0
                        ):
                            goal.crowded_by[higher.id] = (
                                goal.crowded_by.get(higher.id, ZERO) + contribution[higher.id]
                            )
            for goal in active:
                need = max(ZERO, goal.targets[t] - goal.balance)
                pay = min(need, remaining)
                goal.balance += pay
                goal.contributed += pay
                contribution[goal.id] += pay
                remaining -= pay
            free_cash += remaining
        else:
            deficit = -surplus
            from_cash = min(free_cash, deficit)
            free_cash -= from_cash
            deficit -= from_cash
            for goal in emergency + others_lowest_first:
                if deficit <= 0:
                    break
                if goal.realised:
                    continue
                take = min(goal.balance, deficit)
                goal.balance -= take
                goal.withdrawn += take
                withdrawal[goal.id] += take
                deficit -= take
            uncovered = deficit
            if uncovered > 0:
                uncovered_months.append(t)
                uncovered_total += uncovered

        for goal in goals:
            if goal.realised or goal.balance < goal.targets[t]:
                continue
            if goal.first_reached_t is None:
                goal.first_reached_t = t
            if t > goal.spec.deadline and goal.reached_after_deadline_t is None:
                goal.reached_after_deadline_t = t
            if not goal.spec.revolving:
                goal.realised = True
                free_cash += goal.balance - goal.targets[t]
                goal.balance = goal.targets[t]

        for goal in goals:
            if goal.spec.deadline == t:
                goal.balance_at_deadline = goal.balance

        if include_monthly:
            rows.append(
                MonthRow(
                    month=resolved.month_label(t),
                    income=flows.income,
                    expenses=flows.expenses,
                    commitments=flows.commitments,
                    one_offs=flows.one_offs,
                    surplus=surplus,
                    free_cash=free_cash,
                    uncovered_deficit=uncovered,
                    goals=[
                        MonthGoalRow(
                            goal_id=g.id,
                            contribution=contribution[g.id],
                            withdrawal=withdrawal[g.id],
                            growth=growth[g.id],
                            balance=g.balance,
                            required=required[g.id],
                            inflated_target=g.targets[t],
                            realised=g.realised or (g.spec.revolving and g.balance >= g.targets[t]),
                        )
                        for g in goals
                    ],
                )
            )

    outcomes = [_outcome(g, resolved, monthly_return) for g in goals]
    standalone_total = sum((o.required_monthly_level_standalone for o in outcomes), Decimal(0))
    warnings = list(resolved.warnings)
    if uncovered_months:
        warnings.append(
            PlanWarning(
                code="uncovered_deficit",
                message=(
                    f"Savings run out in {len(uncovered_months)} month(s); "
                    f"{quantize(uncovered_total)} cannot be covered."
                ),
                month=resolved.month_label(uncovered_months[0]),
            )
        )

    return ProjectionResult(
        as_of=resolved.as_of,
        horizon_months=horizon,
        summary=ProjectionSummary(
            goals_total=len(outcomes),
            on_track=sum(o.status == "on_track" for o in outcomes),
            delayed=sum(o.status == "delayed" for o in outcomes),
            not_achievable=sum(o.status == "not_achievable" for o in outcomes),
            plan_feasible=not uncovered_months and all(o.status == "on_track" for o in outcomes),
            uncovered_deficit_months=[resolved.month_label(t) for t in uncovered_months],
            overcommitment_ratio=(
                (standalone_total / first_surplus).quantize(Decimal("0.0001"))
                if first_surplus > 0
                else None
            ),
            total_shortfall_today=sum(
                (o.shortfall_at_deadline_today for o in outcomes), Decimal(0)
            ),
        ),
        goals=outcomes,
        monthly=rows,
        warnings=warnings,
    )


def _completion_t(goal: _Goal) -> int | None:
    """Month the goal is funded.

    A locked goal completes in the month it is realised. A revolving goal (an emergency fund)
    can be drawn down, so it only counts as on time if it is still funded at its deadline;
    otherwise it completes when it is next refilled.
    """
    if not goal.spec.revolving:
        return goal.first_reached_t
    target_at_deadline = goal.targets[goal.spec.deadline]
    if goal.balance_at_deadline >= target_at_deadline:
        return goal.first_reached_t
    return goal.reached_after_deadline_t


def _outcome(goal: _Goal, resolved: Resolved, monthly_return: Decimal) -> GoalOutcome:
    spec = goal.spec
    deadline = spec.deadline
    target_at_deadline = goal.targets[deadline]
    completion_t = _completion_t(goal)
    completed = completion_t is not None
    on_time = completed and completion_t <= deadline

    if on_time:
        status = "on_track"
    elif completed:
        status = "delayed"
    else:
        status = "not_achievable"

    shortfall = ZERO if on_time else max(ZERO, target_at_deadline - goal.balance_at_deadline)
    inflation_index = (1 + spec.annual_inflation / 12) ** deadline
    months_counted = completion_t if completed else deadline

    return GoalOutcome(
        goal_id=spec.id,
        label=spec.label,
        status=status,
        target_date=resolved.month_label(deadline),
        target_amount_today=spec.target_today,
        inflated_target_at_deadline=target_at_deadline,
        balance_at_deadline=goal.balance_at_deadline,
        shortfall_at_deadline_nominal=shortfall,
        shortfall_at_deadline_today=quantize(shortfall / inflation_index),
        required_monthly_level_standalone=_standalone_required(goal, monthly_return),
        projected_completion=resolved.month_label(completion_t) if completed else None,
        delay_months=max(0, completion_t - deadline) if completed else None,
        average_monthly_contribution=quantize(goal.contributed / months_counted),
        total_contributed=goal.contributed,
        total_withdrawn=goal.withdrawn,
        crowded_out_by=[
            CrowdedOut(goal_id=other, amount=amount)
            for other, amount in sorted(goal.crowded_by.items())
            if amount > 0
        ],
    )
