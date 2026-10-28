"""Constraint-Aware Rescue Engine.

Resolves multi-goal financial conflicts by generating alternatives and re-running the full
projection for each one. An alternative is only called feasible when the projection shows every
goal on time AND each constraint the person asked for was actually checked and held.

Nothing here invents a figure. Savings from renting or from public transport come only from
amounts the person typed in; spending cuts only touch expenses marked non-essential; loan
payments and other commitments are never reduced.
"""

import uuid
from dataclasses import dataclass, field
from decimal import Decimal

from app.engine.money import ZERO, engine_context, quantize
from app.engine.projection import project
from app.schemas.plan import Plan
from app.schemas.results import GoalOutcome, ProjectionResult, ProjectionSummary
from app.schemas.scenario import (
    ExpenseChange,
    GoalOverride,
    OneTimeIncome,
    Scenario,
)
from app.timeline import index_to_month, month_to_index

RANKING_CRITERIA = (
    "Alternatives that bring every goal on time and meet all your constraints are listed first. "
    "Among those, the one with the smaller remaining shortfall (in today's rupees) comes first, "
    "then the one asking for less extra saving each month. The recommended option is simply the "
    "first in this order; it does not weigh your personal preferences."
)

# Event types that can appear in a scenario. None of them borrows money.
_NON_BORROWING_EVENTS = {"income_change", "expense_change", "one_time_expense", "one_time_income"}

# A hybrid alternative never trims a target by more than this share, and never more than the
# goal's own flexibility allows.
_HYBRID_TARGET_TRIM = Decimal("0.10")
_HYBRID_DELAY_MONTHS = 6


@dataclass
class RescueAlternative:
    alternative_id: str
    title: str
    description: str
    strategy: str  # spending_cut, sequence_delay, target_downscope, hybrid, asset_sale, rent_vs_buy, transit_vs_vehicle
    is_feasible: bool
    scenario: Scenario
    result_summary: ProjectionSummary
    goal_outcomes: list[GoalOutcome]
    monthly_savings_change: Decimal
    total_shortfall_today: Decimal
    constraints_satisfied: list[str]
    constraints_violated: list[str]
    tradeoffs_summary: list[str]
    assumptions: list[str] = field(default_factory=list)


@dataclass
class RescueAnalysisResult:
    is_baseline_feasible: bool
    baseline_summary: ProjectionSummary
    baseline_goals: list[GoalOutcome]
    alternatives: list[RescueAlternative]
    recommended_alternative_id: str | None
    unresolved_gap: Decimal | None
    binding_constraint: str | None
    run_id: str
    ranking_criteria: str = RANKING_CRITERIA
    missing_information: list[str] = field(default_factory=list)
    assumptions: list[str] = field(default_factory=list)


def _emergency_goal_ids(plan: Plan) -> set[str]:
    """Emergency reserves are the goals whose type says so, not goals whose id contains a word."""
    return {g.id for g in plan.goals if g.type == "emergency_fund"}


def _reserve_breach(plan: Plan, result: ProjectionResult, min_reserve: Decimal) -> str | None:
    """Return a message when the emergency reserve drops below the minimum, else None."""
    if min_reserve <= ZERO:
        return None
    emergency_ids = _emergency_goal_ids(plan)
    if not emergency_ids:
        return "No emergency-fund goal exists to hold the minimum reserve you asked for"
    for row in result.monthly:
        held = sum((g.balance for g in row.goals if g.goal_id in emergency_ids), ZERO)
        if held < min_reserve:
            return f"Emergency reserve is Rs {held:,.2f} in {row.month}, below the Rs {min_reserve:,.2f} minimum"
    return None


def _adds_borrowing(scenario: Scenario) -> bool:
    return any(event.type not in _NON_BORROWING_EVENTS for event in scenario.events)


def run_rescue_analysis(
    plan: Plan,
    scenario: Scenario | None = None,
    avoid_new_debt: bool = True,
    min_emergency_reserve: Decimal = ZERO,
    max_delay_months: int = 24,
    allow_discretionary_cut_pct: Decimal = Decimal("0.20"),
    allow_asset_sale: bool = False,
    asset_sale_amount: Decimal = ZERO,
    housing_mode: str | None = None,  # "rent_vs_buy"
    transit_mode: str | None = None,  # "transit_vs_car"
    housing_monthly_saving: Decimal | None = None,
    transit_monthly_saving: Decimal | None = None,
    extra_monthly_budget: Decimal = ZERO,
) -> RescueAnalysisResult:
    """Analyze conflicting financial objectives and generate validated alternatives."""
    scenario = scenario or Scenario()
    run_id = f"run_{uuid.uuid4().hex[:12]}"
    # Monthly rows are needed to check the emergency reserve month by month.
    need_monthly = min_emergency_reserve > ZERO
    missing: list[str] = []
    assumptions = [
        "Each alternative is a full re-run of the projection, not an estimate.",
        "Spending cuts apply only to expenses marked non-essential. Loan payments and other "
        "commitments are never reduced.",
        "No borrowing is modelled in any alternative.",
        f"Inflation {plan.assumptions.general_inflation_annual}/year and savings return "
        f"{plan.assumptions.savings_return_annual}/year come from the plan, not from this engine.",
    ]

    with engine_context():
        base_res = project(plan, scenario, include_monthly=True)
        base_feasible = base_res.summary.plan_feasible
        base_reserve_breach = _reserve_breach(plan, base_res, min_emergency_reserve)

        if base_feasible and base_reserve_breach is None:
            return RescueAnalysisResult(
                is_baseline_feasible=True,
                baseline_summary=base_res.summary,
                baseline_goals=base_res.goals,
                alternatives=[],
                recommended_alternative_id=None,
                unresolved_gap=ZERO,
                binding_constraint=None,
                run_id=run_id,
                assumptions=assumptions,
            )

        failing_goal_ids = [g.goal_id for g in base_res.goals if g.status != "on_track"]
        emergency_ids = _emergency_goal_ids(plan)
        alternatives: list[RescueAlternative] = []

        def add(**kwargs) -> None:
            _evaluate_and_add_alternative(
                alternatives=alternatives,
                plan=plan,
                avoid_new_debt=avoid_new_debt,
                min_emergency_reserve=min_emergency_reserve,
                base_res=base_res,
                **kwargs,
            )

        # ------------------------------------------------------------------
        # Strategy 1: trim spending the person marked as non-essential
        # ------------------------------------------------------------------
        discretionary_total = sum((e.monthly for e in plan.expenses if not e.essential), ZERO)
        if allow_discretionary_cut_pct > ZERO:
            cut_amount = quantize(discretionary_total * allow_discretionary_cut_pct)
            if cut_amount > ZERO:
                last_month = base_res.monthly[-1].month if base_res.monthly else plan.as_of
                cut_scenario = scenario.model_copy(
                    update={
                        "name": f"Trim non-essential spending by {int(allow_discretionary_cut_pct * 100)}%",
                        "events": [
                            *scenario.events,
                            ExpenseChange(
                                type="expense_change",
                                from_month=plan.as_of,
                                to_month=last_month,
                                delta_monthly=-cut_amount,
                            ),
                        ],
                    }
                )
                add(
                    alt_id="alt_spend_cut_1",
                    title=f"Trim non-essential spending ({int(allow_discretionary_cut_pct * 100)}%)",
                    description=(
                        f"Spend Rs {cut_amount:,.2f} less each month on the expenses you marked "
                        f"non-essential (their total is Rs {discretionary_total:,.2f})."
                    ),
                    strategy="spending_cut",
                    scenario=cut_scenario,
                    result=project(plan, cut_scenario, include_monthly=need_monthly),
                    monthly_savings_change=cut_amount,
                    assumptions=[
                        f"Cuts {int(allow_discretionary_cut_pct * 100)}% of expenses marked non-essential only."
                    ],
                )
            else:
                missing.append(
                    "No expenses are marked non-essential, so no spending cut is offered. "
                    "Mark an expense as non-essential to include one."
                )

        # ------------------------------------------------------------------
        # Strategy 2: move the lowest-priority late goals later (never emergency money)
        # ------------------------------------------------------------------
        late_goals = sorted(
            [g for g in plan.goals if g.id in failing_goal_ids and g.id not in emergency_ids],
            key=lambda g: g.priority,
            reverse=True,
        )
        for target_goal in late_goals[:2]:
            delay_step = min(max_delay_months, target_goal.flexibility.max_delay_months)
            if delay_step <= 0:
                continue
            new_target_date = index_to_month(month_to_index(target_goal.target_date) + delay_step)
            delay_scenario = scenario.model_copy(
                update={
                    "name": f"Reschedule {target_goal.label} (+{delay_step}m)",
                    "goal_overrides": [
                        *scenario.goal_overrides,
                        GoalOverride(goal_id=target_goal.id, target_date=new_target_date),
                    ],
                }
            )
            add(
                alt_id=f"alt_delay_{target_goal.id}",
                title=f"Reschedule {target_goal.label} by {delay_step} months",
                description=(
                    f"Move {target_goal.label} from {target_goal.target_date} to {new_target_date}."
                ),
                strategy="sequence_delay",
                scenario=delay_scenario,
                result=project(plan, delay_scenario, include_monthly=need_monthly),
                monthly_savings_change=ZERO,
                assumptions=[
                    f"Delay of {delay_step} months is the most this goal allows "
                    f"(its own limit is {target_goal.flexibility.max_delay_months})."
                ],
            )

        # ------------------------------------------------------------------
        # Strategy 3: lower the target of a flexible goal (home or custom) to its stated minimum
        # ------------------------------------------------------------------
        for target_goal in plan.goals:
            if target_goal.id in failing_goal_ids and target_goal.type in ("home", "custom"):
                min_pct = target_goal.flexibility.min_target_pct
                trimmed_target = quantize(target_goal.target_amount_today * min_pct)
                if trimmed_target >= target_goal.target_amount_today:
                    continue
                downscope_scenario = scenario.model_copy(
                    update={
                        "name": f"Lower the {target_goal.label} target",
                        "goal_overrides": [
                            *scenario.goal_overrides,
                            GoalOverride(
                                goal_id=target_goal.id, target_amount_today=trimmed_target
                            ),
                        ],
                    }
                )
                add(
                    alt_id=f"alt_scope_{target_goal.id}",
                    title=f"Lower {target_goal.label} target to {int(min_pct * 100)}%",
                    description=(
                        f"Change the {target_goal.label} target from "
                        f"Rs {target_goal.target_amount_today:,.2f} to Rs {trimmed_target:,.2f}."
                    ),
                    strategy="target_downscope",
                    scenario=downscope_scenario,
                    result=project(plan, downscope_scenario, include_monthly=need_monthly),
                    monthly_savings_change=ZERO,
                    assumptions=[
                        f"{int(min_pct * 100)}% is the lowest target this goal says it can accept."
                    ],
                )

        # ------------------------------------------------------------------
        # Strategy 4: a small combination, only on goals that can flex
        # ------------------------------------------------------------------
        flexible = [g for g in plan.goals if g.id in failing_goal_ids and g.id not in emergency_ids]
        if flexible:
            overrides = list(scenario.goal_overrides)
            parts: list[str] = []
            for goal in flexible:
                delay = min(
                    _HYBRID_DELAY_MONTHS, max_delay_months, goal.flexibility.max_delay_months
                )
                trim = min(_HYBRID_TARGET_TRIM, Decimal(1) - goal.flexibility.min_target_pct)
                new_date = index_to_month(month_to_index(goal.target_date) + delay)
                new_target = quantize(goal.target_amount_today * (Decimal(1) - trim))
                overrides.append(
                    GoalOverride(
                        goal_id=goal.id, target_date=new_date, target_amount_today=new_target
                    )
                )
                parts.append(f"{goal.label}: +{delay} months, target lowered {int(trim * 100)}%")
            hybrid_scenario = scenario.model_copy(
                update={
                    "name": "Combined small adjustments",
                    "goal_overrides": overrides,
                    "extra_monthly_savings": scenario.extra_monthly_savings + extra_monthly_budget,
                }
            )
            description = "; ".join(parts) + "."
            if extra_monthly_budget > ZERO:
                description += f" Plus Rs {extra_monthly_budget:,.2f} more saved each month."
            add(
                alt_id="alt_hybrid_balanced",
                title="Combine small delays and target trims",
                description=description,
                strategy="hybrid",
                scenario=hybrid_scenario,
                result=project(plan, hybrid_scenario, include_monthly=need_monthly),
                monthly_savings_change=extra_monthly_budget,
                assumptions=[
                    "Emergency money is never delayed or trimmed.",
                    "Each trim and delay stays inside that goal's own flexibility limits.",
                ],
            )

        # ------------------------------------------------------------------
        # Strategy 5: a one-off amount the person chose to release
        # ------------------------------------------------------------------
        if allow_asset_sale and asset_sale_amount > ZERO:
            sale_scenario = scenario.model_copy(
                update={
                    "name": f"Use Rs {asset_sale_amount:,.2f} you chose to release",
                    "events": [
                        *scenario.events,
                        OneTimeIncome(
                            type="one_time_income",
                            month=plan.as_of,
                            amount=asset_sale_amount,
                            label="Amount released by you",
                        ),
                    ],
                }
            )
            add(
                alt_id="alt_asset_sale",
                title=f"Use Rs {asset_sale_amount:,.2f} you chose to release",
                description=(
                    f"Add Rs {asset_sale_amount:,.2f} in {plan.as_of}. ArthaYukti has not checked "
                    "that you hold an asset worth this amount or what selling it would cost."
                ),
                strategy="asset_sale",
                scenario=sale_scenario,
                result=project(plan, sale_scenario, include_monthly=need_monthly),
                monthly_savings_change=ZERO,
                assumptions=[
                    "The amount is the one you entered. Taxes and selling costs are not modelled."
                ],
            )

        # ------------------------------------------------------------------
        # Strategies 6 and 7: only with a monthly amount the person supplied
        # ------------------------------------------------------------------
        if housing_mode == "rent_vs_buy":
            if housing_monthly_saving is not None and housing_monthly_saving > ZERO:
                rent_saving = quantize(housing_monthly_saving)
                rent_scenario = scenario.model_copy(
                    update={
                        "name": "Rent and put the difference towards goals",
                        "extra_monthly_savings": scenario.extra_monthly_savings + rent_saving,
                    }
                )
                add(
                    alt_id="alt_rent_vs_buy",
                    title="Rent and put the monthly difference towards goals",
                    description=(
                        f"Uses the Rs {rent_saving:,.2f} per month you entered as the saving from "
                        "renting instead of buying. ArthaYukti has not verified that figure and "
                        "does not model rent increases, deposits or the value of owning."
                    ),
                    strategy="rent_vs_buy",
                    scenario=rent_scenario,
                    result=project(plan, rent_scenario, include_monthly=need_monthly),
                    monthly_savings_change=rent_saving,
                    assumptions=["The monthly saving is your own estimate."],
                )
            else:
                missing.append(
                    "To compare renting with buying, enter how much less you would spend each "
                    "month by renting."
                )
        if transit_mode == "transit_vs_car":
            if transit_monthly_saving is not None and transit_monthly_saving > ZERO:
                transit_saving = quantize(transit_monthly_saving)
                transit_scenario = scenario.model_copy(
                    update={
                        "name": "Use public transport and put the difference towards goals",
                        "extra_monthly_savings": scenario.extra_monthly_savings + transit_saving,
                    }
                )
                add(
                    alt_id="alt_transit_vs_car",
                    title="Use public transport and put the monthly difference towards goals",
                    description=(
                        f"Uses the Rs {transit_saving:,.2f} per month you entered as the saving "
                        "from public transport instead of a car. ArthaYukti has not verified that "
                        "figure, and public transport may not suit every journey or person."
                    ),
                    strategy="transit_vs_vehicle",
                    scenario=transit_scenario,
                    result=project(plan, transit_scenario, include_monthly=need_monthly),
                    monthly_savings_change=transit_saving,
                    assumptions=["The monthly saving is your own estimate."],
                )
            else:
                missing.append(
                    "To compare public transport with a car, enter how much less you would spend "
                    "each month."
                )

        alternatives.sort(
            key=lambda a: (
                0 if a.is_feasible else 1,
                a.total_shortfall_today,
                a.monthly_savings_change,
            )
        )

        recommended_id = next((a.alternative_id for a in alternatives if a.is_feasible), None)

        binding_constraint = None
        unresolved_gap = None
        if recommended_id is None:
            unresolved_gap = min(
                (a.total_shortfall_today for a in alternatives),
                default=base_res.summary.total_shortfall_today,
            )
            binding_constraint = (
                "No alternative brings every goal on time while meeting your constraints. "
                f"The smallest remaining shortfall is Rs {unresolved_gap:,.2f} (today's money)."
            )
            if base_reserve_breach:
                binding_constraint += f" {base_reserve_breach}."

        return RescueAnalysisResult(
            is_baseline_feasible=False,
            baseline_summary=base_res.summary,
            baseline_goals=base_res.goals,
            alternatives=alternatives,
            recommended_alternative_id=recommended_id,
            unresolved_gap=unresolved_gap,
            binding_constraint=binding_constraint,
            run_id=run_id,
            missing_information=missing,
            assumptions=assumptions,
        )


def _evaluate_and_add_alternative(
    alternatives: list[RescueAlternative],
    plan: Plan,
    alt_id: str,
    title: str,
    description: str,
    strategy: str,
    scenario: Scenario,
    result: ProjectionResult,
    monthly_savings_change: Decimal,
    avoid_new_debt: bool,
    min_emergency_reserve: Decimal,
    base_res: ProjectionResult,
    assumptions: list[str] | None = None,
) -> None:
    constraints_satisfied: list[str] = []
    constraints_violated: list[str] = []

    if result.summary.plan_feasible:
        constraints_satisfied.append("Every goal is on time")
    else:
        constraints_violated.append(
            f"{result.summary.delayed + result.summary.not_achievable} goals still miss their dates"
        )

    if not result.summary.uncovered_deficit_months:
        constraints_satisfied.append("No month runs out of money")
    else:
        constraints_violated.append(
            f"Money runs out in {len(result.summary.uncovered_deficit_months)} months"
        )

    # Checked, not assumed: a constraint is only listed as satisfied after the check passes.
    if avoid_new_debt:
        if _adds_borrowing(scenario):
            constraints_violated.append("This alternative would involve borrowing")
        else:
            constraints_satisfied.append("No borrowing is modelled")

    if min_emergency_reserve > ZERO:
        breach = _reserve_breach(plan, result, min_emergency_reserve)
        if breach:
            constraints_violated.append(breach)
        else:
            constraints_satisfied.append(
                f"Emergency reserve stays at or above Rs {min_emergency_reserve:,.2f} every month"
            )

    tradeoffs: list[str] = []
    shortfall_diff = result.summary.total_shortfall_today - base_res.summary.total_shortfall_today
    if shortfall_diff < ZERO:
        tradeoffs.append(f"Reduces total shortfall by Rs {abs(shortfall_diff):,.2f}")
    if monthly_savings_change > ZERO:
        tradeoffs.append(f"Needs Rs {monthly_savings_change:,.2f} more saved each month")

    alternatives.append(
        RescueAlternative(
            alternative_id=alt_id,
            title=title,
            description=description,
            strategy=strategy,
            is_feasible=result.summary.plan_feasible and not constraints_violated,
            scenario=scenario,
            result_summary=result.summary,
            goal_outcomes=result.goals,
            monthly_savings_change=monthly_savings_change,
            total_shortfall_today=result.summary.total_shortfall_today,
            constraints_satisfied=constraints_satisfied,
            constraints_violated=constraints_violated,
            tradeoffs_summary=tradeoffs,
            assumptions=assumptions or [],
        )
    )
