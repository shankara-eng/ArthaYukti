"""Side-by-side scenarios. Differences are measured against the first scenario."""

from app.engine.money import engine_context
from app.engine.projection import project
from app.schemas.plan import Plan
from app.schemas.results import CompareDiff, CompareEntry, CompareResult
from app.schemas.scenario import Scenario
from app.timeline import month_to_index


def compare(plan: Plan, scenarios: list[Scenario]) -> CompareResult:
    with engine_context():
        results = [project(plan, scenario, include_monthly=False) for scenario in scenarios]

    entries = [
        CompareEntry(scenario_name=scenario.name, summary=result.summary, goals=result.goals)
        for scenario, result in zip(scenarios, results, strict=True)
    ]
    base = {goal.goal_id: goal for goal in results[0].goals}
    diffs: list[CompareDiff] = []
    for scenario, result in zip(scenarios[1:], results[1:], strict=True):
        for goal in result.goals:
            before = base[goal.goal_id]
            shift = None
            if goal.projected_completion and before.projected_completion:
                shift = month_to_index(goal.projected_completion) - month_to_index(
                    before.projected_completion
                )
            diffs.append(
                CompareDiff(
                    scenario_name=scenario.name,
                    goal_id=goal.goal_id,
                    completion_shift_months=shift,
                    shortfall_change_today=(
                        goal.shortfall_at_deadline_today - before.shortfall_at_deadline_today
                    ),
                )
            )
    return CompareResult(results=entries, diffs=diffs)
