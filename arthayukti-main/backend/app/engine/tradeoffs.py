from decimal import Decimal

from app.engine.money import engine_context
from app.engine.projection import project
from app.schemas.plan import Plan
from app.schemas.results import (
    TradeoffOutcome,
    TradeoffResult,
    TradeoffRow,
    TradeoffTotals,
)
from app.schemas.scenario import Scenario


def compute_tradeoffs(plan: Plan, scenario: Scenario | None = None) -> TradeoffResult:
    """Compute the trade-off matrix by systematically moving each goal to priority 1."""
    scenario = scenario or Scenario()
    with engine_context():
        baseline_res = project(plan, scenario, include_monthly=False)

        # Baseline priority order
        if scenario.priority_order is not None:
            base_order = list(scenario.priority_order)
        else:
            sorted_goals = sorted(plan.goals, key=lambda g: g.priority)
            base_order = [g.id for g in sorted_goals]

        rows: list[TradeoffRow] = []

        for goal_id in base_order:
            # Move goal_id to top, keeping other goals in their existing relative order
            new_order = [goal_id] + [g for g in base_order if g != goal_id]
            variant_scenario = scenario.model_copy(update={"priority_order": new_order})
            variant_res = project(plan, variant_scenario, include_monthly=False)

            outcomes: list[TradeoffOutcome] = []
            for goal_outcome in variant_res.goals:
                outcomes.append(
                    TradeoffOutcome(
                        goal_id=goal_outcome.goal_id,
                        status=goal_outcome.status,
                        delay_months=goal_outcome.delay_months,
                        shortfall_today=goal_outcome.shortfall_at_deadline_today,
                    )
                )

            goals_missed = sum(1 for o in outcomes if o.status != "on_track")
            total_delay = sum((o.delay_months or 0) for o in outcomes)
            total_shortfall = sum((o.shortfall_today for o in outcomes), Decimal("0.00"))

            rows.append(
                TradeoffRow(
                    prioritised_goal_id=goal_id,
                    priority_order=new_order,
                    outcomes=outcomes,
                    totals=TradeoffTotals(
                        goals_missed=goals_missed,
                        total_delay_months=total_delay,
                        total_shortfall_today=total_shortfall,
                    ),
                )
            )

        return TradeoffResult(
            baseline=baseline_res.summary,
            rows=rows,
        )
