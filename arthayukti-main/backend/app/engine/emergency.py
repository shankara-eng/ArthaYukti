"""Emergency-fund analysis, built on the same projection engine as the rest of the app.

The reserve is the saved balance of the plan's emergency-fund goal, counted once. Bank balances marked liquid are
a separate record and are never added to it, and contributions are only those the projection allocates to the
goal, so nothing is counted twice.
"""

from decimal import ROUND_HALF_UP, Decimal

from app.engine.expenditure import is_running
from app.engine.projection import project
from app.schemas.emergency import EmergencyAnalysis, ReservePoint
from app.schemas.plan import Commitment, Expense, Plan
from app.timeline import month_to_index

CENT = Decimal("0.01")
ZERO = Decimal("0.00")


def _essentials(expenses: list[Expense], commitments: list[Commitment], as_of: str | None) -> Decimal:
    # A scheduled line that has not started yet (or has ended) is not part of what is spent today.
    index = month_to_index(as_of) if as_of else None
    spending = sum((e.monthly for e in expenses if e.essential and (index is None or is_running(e, index))), ZERO)
    loans = sum((c.monthly_payment for c in commitments), ZERO)
    return (spending + loans).quantize(CENT, rounding=ROUND_HALF_UP)


def analyze_emergency(
    plan: Plan | None,
    target_months: int | None,
    expenses: list[Expense] | None = None,
    commitments: list[Commitment] | None = None,
    as_of: str | None = None,
) -> EmergencyAnalysis:
    if plan is not None:
        expenses, commitments, as_of = plan.expenses, plan.commitments, plan.as_of
    essentials = _essentials(expenses or [], commitments or [], as_of)
    goals = sorted(plan.goals, key=lambda g: (g.priority, g.id)) if plan is not None else []
    goal = next((g for g in goals if g.type == "emergency_fund"), None)
    target = (essentials * target_months).quantize(CENT) if target_months else None
    notes = [
        "The reserve is the saved balance of your emergency-fund goal, counted once. Money in your bank accounts is "
        "a separate record and is not added to it.",
        "Monthly essentials are your essential spending plus your fixed loan payments.",
    ]
    if target_months is None:
        notes.append("You have not set a target in months yet, so no target amount or progress is shown.")
    if essentials == ZERO:
        notes.append("No essential spending is entered yet, so months of cover cannot be worked out.")

    held = covered = progress = shortfall = None
    projected: list[ReservePoint] = []
    status = completion = None
    if goal is None:
        notes.append("No emergency-fund goal exists yet. Add one to track a reserve and see how it grows.")
    else:
        held = goal.current_savings.quantize(CENT)
        if essentials > ZERO:
            covered = str((held / essentials).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))
        if target is not None:
            if target > ZERO:
                progress = min(Decimal(1), held / target).quantize(Decimal("0.0001"))
            shortfall = max(ZERO, target - held)
        try:
            result = project(plan, None, True) if plan is not None else None
        except ValueError:
            result = None
        if result is not None:
            outcome = next((o for o in result.goals if o.goal_id == goal.id), None)
            if outcome is not None:
                status, completion = outcome.status, outcome.projected_completion
            for row in result.monthly[:24]:
                line = next((g for g in row.goals if g.goal_id == goal.id), None)
                if line is not None:
                    projected.append(ReservePoint(month=row.month, balance=line.balance))
            notes.append(
                "The projection uses your plan as it is now, with the contributions the engine allocates to this goal."
            )

    return EmergencyAnalysis(
        monthly_essentials=essentials,
        target_months=target_months,
        target_amount=target,
        has_goal=goal is not None,
        goal_id=goal.id if goal else None,
        goal_label=goal.label if goal else None,
        goal_target_today=goal.target_amount_today if goal else None,
        reserve_held=held,
        months_covered=covered,
        progress=progress,
        shortfall_to_target=shortfall,
        projected=projected,
        goal_status=status,
        projected_completion=completion,
        notes=notes,
    )
