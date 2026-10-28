"""Minimal-fix search (docs/FINANCIAL_MODEL.md, section 9).

Every option is verified by re-running the projection on the changed scenario.
"""

from decimal import Decimal

from app.engine.money import engine_context, quantize
from app.engine.projection import project
from app.engine.setup import Resolved, resolve
from app.schemas.plan import Plan
from app.schemas.results import FixOption, FixResult, GoalOutcome, ProjectionResult
from app.schemas.scenario import GoalOverride, Scenario
from app.timeline import index_to_month, month_to_index

RUPEE_STEP = Decimal(100)
LEVER_ORDER = {"extra_savings": 0, "delay_goal": 1, "reduce_target": 2}
COST_PLACES = Decimal("0.001")


def find_fixes(plan: Plan, scenario: Scenario | None = None) -> FixResult:
    scenario = scenario or Scenario()
    with engine_context():
        return _find_fixes(plan, scenario)


def _failing(result: ProjectionResult) -> list[str]:
    return [g.goal_id for g in result.goals if g.status != "on_track"]


def _fixed(result: ProjectionResult) -> bool:
    return result.summary.plan_feasible


def _run(plan: Plan, scenario: Scenario) -> ProjectionResult:
    return project(plan, scenario, include_monthly=False)


def _with_extra(scenario: Scenario, extra: Decimal) -> Scenario:
    return scenario.model_copy(
        update={"extra_monthly_savings": scenario.extra_monthly_savings + extra}
    )


def _with_override(scenario: Scenario, goal_id: str, **changes) -> Scenario:
    merged: dict[str, object] = {}
    kept: list[GoalOverride] = []
    for override in scenario.goal_overrides:
        if override.goal_id == goal_id:
            merged = {
                "target_date": override.target_date,
                "target_amount_today": override.target_amount_today,
            }
        else:
            kept.append(override)
    merged.update(changes)
    kept.append(GoalOverride(goal_id=goal_id, **merged))
    return scenario.model_copy(update={"goal_overrides": kept})


def _cost(magnitude: Decimal, cap: Decimal) -> Decimal:
    return (magnitude / cap).quantize(COST_PLACES)


def _find_fixes(plan: Plan, scenario: Scenario) -> FixResult:
    base = _run(plan, scenario)
    failing = _failing(base)
    if not failing and not base.summary.uncovered_deficit_months:
        return FixResult(
            needs_fix=False, options=[], recommended_option_id=None, no_single_fix_reason=None
        )

    resolved = resolve(plan, scenario)
    candidates: list[tuple[tuple, FixOption]] = []

    def add(option: FixOption, goal_rank: int) -> None:
        candidates.append(((LEVER_ORDER[option.lever], goal_rank), option))

    extra = _extra_savings_option(plan, scenario, failing)
    if extra is not None:
        add(extra, 0)

    for rank, goal_id in enumerate(_by_priority(resolved, failing)):
        delay = _delay_option(plan, scenario, resolved, failing, goal_id)
        if delay is not None:
            add(delay, rank)
        reduce = _reduce_option(plan, scenario, resolved, failing, goal_id)
        if reduce is not None:
            add(reduce, rank)

    full = [c for c in candidates if not c[1].leaves_unresolved and _option_fixes_all(c[1])]
    if full:
        ordered = sorted(full, key=lambda c: (c[1].normalised_cost, c[0]))
        options = [option for _, option in ordered]
        return FixResult(
            needs_fix=True,
            options=options,
            recommended_option_id=options[0].id,
            no_single_fix_reason=None,
        )

    ordered = sorted(
        candidates, key=lambda c: (len(c[1].leaves_unresolved), c[1].normalised_cost, c[0])
    )
    options = [option for _, option in ordered]
    best_helps = bool(options) and bool(options[0].resolves)
    return FixResult(
        needs_fix=True,
        options=options,
        recommended_option_id=options[0].id if best_helps else None,
        no_single_fix_reason="No single change fixes every goal within the limits you set.",
    )


def _option_fixes_all(option: FixOption) -> bool:
    return option.result_summary.plan_feasible


def _by_priority(resolved: Resolved, goal_ids: list[str]) -> list[str]:
    wanted = set(goal_ids)
    return [spec.id for spec in resolved.goals if spec.id in wanted]


def _summarise(
    option_id: str,
    lever: str,
    goal_id: str | None,
    magnitude: Decimal,
    unit: str,
    cost: Decimal,
    delta: Scenario,
    before_failing: list[str],
    after: ProjectionResult,
) -> FixOption:
    still = _failing(after)
    return FixOption(
        id=option_id,
        lever=lever,
        goal_id=goal_id,
        magnitude=magnitude,
        unit=unit,
        normalised_cost=cost,
        resolves=[g for g in before_failing if g not in still],
        leaves_unresolved=still,
        scenario_delta=delta,
        result_summary=after.summary,
    )


def _extra_savings_option(plan: Plan, scenario: Scenario, failing: list[str]) -> FixOption | None:
    income = sum((stream.monthly_net for stream in plan.income_streams), Decimal(0))
    cap = income * plan.fix_limits.extra_savings_cap_pct_of_income
    steps = int(cap // RUPEE_STEP)
    if steps < 1:
        return None

    def result_for(step: int) -> ProjectionResult:
        return _run(plan, _with_extra(scenario, RUPEE_STEP * step))

    if not _fixed(result_for(steps)):
        return None
    low, high = 1, steps
    while low < high:
        middle = (low + high) // 2
        if _fixed(result_for(middle)):
            high = middle
        else:
            low = middle + 1
    amount = quantize(RUPEE_STEP * low)
    after = result_for(low)
    delta = Scenario(name="Save more each month", extra_monthly_savings=amount)
    return _summarise(
        "extra_savings",
        "extra_savings",
        None,
        amount,
        "rupees_per_month",
        _cost(amount, cap),
        delta,
        failing,
        after,
    )


def _delay_option(
    plan: Plan,
    scenario: Scenario,
    resolved: Resolved,
    failing: list[str],
    goal_id: str,
) -> FixOption | None:
    spec = next(s for s in resolved.goals if s.id == goal_id)
    flexibility = next(g for g in plan.goals if g.id == goal_id).flexibility
    limit = flexibility.max_delay_months
    current = month_to_index(resolved.month_label(spec.deadline))
    for months in range(1, limit + 1):
        changed = _with_override(scenario, goal_id, target_date=index_to_month(current + months))
        after = _run(plan, changed)
        if _goal_on_track(after, goal_id):
            delta = Scenario(
                name="Wait a little longer",
                goal_overrides=[
                    GoalOverride(goal_id=goal_id, target_date=index_to_month(current + months))
                ],
            )
            return _summarise(
                f"delay_goal:{goal_id}",
                "delay_goal",
                goal_id,
                Decimal(months),
                "months",
                _cost(Decimal(months), Decimal(limit)),
                delta,
                failing,
                after,
            )
    return None


def _reduce_option(
    plan: Plan,
    scenario: Scenario,
    resolved: Resolved,
    failing: list[str],
    goal_id: str,
) -> FixOption | None:
    spec = next(s for s in resolved.goals if s.id == goal_id)
    flexibility = next(g for g in plan.goals if g.id == goal_id).flexibility
    cap_percent = (1 - flexibility.min_target_pct) * 100
    for percent in range(1, int(cap_percent) + 1):
        amount = (spec.target_today * (100 - percent) / 100).quantize(Decimal("0.01"))
        if amount <= 0:
            break
        changed = _with_override(scenario, goal_id, target_amount_today=amount)
        after = _run(plan, changed)
        if _goal_on_track(after, goal_id):
            delta = Scenario(
                name="Aim a little lower",
                goal_overrides=[GoalOverride(goal_id=goal_id, target_amount_today=amount)],
            )
            return _summarise(
                f"reduce_target:{goal_id}",
                "reduce_target",
                goal_id,
                Decimal(percent),
                "percent",
                _cost(Decimal(percent), cap_percent),
                delta,
                failing,
                after,
            )
    return None


def _goal_on_track(result: ProjectionResult, goal_id: str) -> bool:
    outcome: GoalOutcome = next(g for g in result.goals if g.goal_id == goal_id)
    return outcome.status == "on_track"
