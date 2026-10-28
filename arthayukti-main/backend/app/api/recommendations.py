from decimal import Decimal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from app.api.common import AUTH_RESPONSES, VALIDATION_RESPONSES
from app.api.deps import get_current_user, get_db
from app.db.models import SavedPlan, User
from app.engine.projection import project
from app.errors import ApiError
from app.schemas.plan import Plan, PlanWithGoals
from app.schemas.recommendations import (
    ConservativeComparisonResponse,
    GoalRecommendationItem,
    RecommendationDifferences,
    RecommendationVariant,
)
from app.schemas.scenario import Scenario

router = APIRouter(prefix="/recommendations", tags=["recommendations"], responses=AUTH_RESPONSES)


class RecommendationComparisonRequest(BaseModel):
    """Give `plan_id` to use the signed-in user's saved plan, or `plan` for an explicit hypothetical."""

    plan_id: str | None = None
    plan: PlanWithGoals | None = None
    scenario: Scenario | None = None
    conservative_return_drop: Decimal = Field(default=Decimal("0.025"), ge=Decimal("0"), le=Decimal("0.20"))

    @model_validator(mode="after")
    def exactly_one_plan_source(self) -> "RecommendationComparisonRequest":
        if (self.plan_id is None) == (self.plan is None):
            raise ValueError("Send either plan_id (a saved plan) or plan (a hypothetical plan), not both or neither.")
        return self


@router.post(
    "/conservative-comparison",
    response_model=ConservativeComparisonResponse,
    responses=VALIDATION_RESPONSES,
)
def compare_conservative_recommendations(
    req: RecommendationComparisonRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ConservativeComparisonResponse:
    """Compare baseline recommendations with a deterministic, more conservative variant.

    The conservative variant applies a lower investment growth rate and an expanded defensive
    reserve buffer without modifying or overwriting the original plan or assessment records."""
    if req.plan_id is not None:
        record = db.query(SavedPlan).filter(SavedPlan.id == req.plan_id, SavedPlan.user_id == user.id).first()
        if record is None:
            raise ApiError(404, "not_found", "Plan not found.")
        plan_source = "saved"
        chosen_plan = Plan.model_validate_json(record.plan_json)
    else:
        plan_source = "hypothetical"
        chosen_plan = req.plan  # type: ignore[assignment]
    try:
        orig_plan = chosen_plan
        orig_return = orig_plan.assumptions.savings_return_annual

        # 1. Run baseline original projection
        orig_res = project(orig_plan, req.scenario, include_monthly=False)

        orig_goals = [
            GoalRecommendationItem(
                goal_id=g.goal_id,
                label=g.label,
                target_amount_today=g.target_amount_today,
                target_date=g.target_date,
                status=g.status,
                projected_completion=g.projected_completion,
                delay_months=g.delay_months,
                required_monthly_savings=g.required_monthly_level_standalone,
            )
            for g in orig_res.goals
        ]
        orig_total_monthly = sum((g.required_monthly_savings for g in orig_goals), Decimal("0.00"))
        orig_on_track = sum(1 for g in orig_goals if g.status == "on_track")
        orig_delayed = sum(1 for g in orig_goals if g.status != "on_track")

        orig_variant = RecommendationVariant(
            name="original",
            label="Original Recommendations",
            assumed_annual_return=str(orig_return),
            recommended_reserve_months=6,
            total_monthly_required=orig_total_monthly,
            on_track_count=orig_on_track,
            delayed_count=orig_delayed,
            goals=orig_goals,
        )

        # 2. Build conservative variant: lower return rate
        if orig_return > req.conservative_return_drop:
            conservative_return = orig_return - req.conservative_return_drop
        else:
            conservative_return = Decimal("0.00")
        conservative_assumptions = orig_plan.assumptions.model_copy(
            update={"savings_return_annual": conservative_return}
        )
        conservative_plan = orig_plan.model_copy(update={"assumptions": conservative_assumptions})

        # Run conservative projection
        conservative_res = project(conservative_plan, req.scenario, include_monthly=False)

        cons_goals = [
            GoalRecommendationItem(
                goal_id=g.goal_id,
                label=g.label,
                target_amount_today=g.target_amount_today,
                target_date=g.target_date,
                status=g.status,
                projected_completion=g.projected_completion,
                delay_months=g.delay_months,
                required_monthly_savings=g.required_monthly_level_standalone,
            )
            for g in conservative_res.goals
        ]
        cons_total_monthly = sum((g.required_monthly_savings for g in cons_goals), Decimal("0.00"))
        cons_on_track = sum(1 for g in cons_goals if g.status == "on_track")
        cons_delayed = sum(1 for g in cons_goals if g.status != "on_track")

        cons_variant = RecommendationVariant(
            name="conservative",
            label="More Conservative Recommendations",
            assumed_annual_return=str(conservative_return),
            recommended_reserve_months=12,
            total_monthly_required=cons_total_monthly,
            on_track_count=cons_on_track,
            delayed_count=cons_delayed,
            goals=cons_goals,
        )

        # 3. Calculate differences
        return_drop = orig_return - conservative_return
        return_drop_pct = return_drop * 100
        monthly_diff = max(Decimal("0.00"), cons_total_monthly - orig_total_monthly)

        # Essential monthly spending for reserve difference
        monthly_essentials = sum(
            (e.monthly for e in orig_plan.expenses if e.essential), Decimal("0.00")
        )
        extra_reserve_needed = monthly_essentials * Decimal(6)

        delays: list[str] = []
        for og, cg in zip(orig_goals, cons_goals, strict=False):
            if cg.delay_months > og.delay_months:
                added = cg.delay_months - og.delay_months
                delays.append(f"{cg.label}: projected completion delayed by {added} month(s) under lower return.")
            elif cg.required_monthly_savings > og.required_monthly_savings:
                diff = cg.required_monthly_savings - og.required_monthly_savings
                delays.append(f"{cg.label}: requires ₹{diff:,.2f} more monthly savings to stay on schedule.")

        notes: list[str] = []
        if return_drop == 0:
            notes.append(
                "This plan assumes no investment return, so lowering the return changes nothing: both versions "
                "give the same results. The conservative version differs only in the reserve guideline."
            )
        if not delays:
            if cons_on_track == len(cons_goals):
                delays.append("Every goal stays on time under the lower return.")
            else:
                delays.append("No goal's timeline or required saving changes under the lower return.")
        notes.append(
            "The reserve figures are guidelines. The recalculated projections do not add a larger emergency reserve "
            "to the plan."
        )
        if orig_plan.goals and any(g.status != "on_track" for g in cons_goals):
            notes.append("Some goals are not on time in either version; the conservative version does not fix them.")

        summary = (
            f"The conservative variant models a lower annual return of {conservative_return * 100:.1f}% "
            f"(down {return_drop_pct:.1f}% from {orig_return * 100:.1f}%) and shows a 12-month reserve guideline "
            f"(not included in the projection). Lower compounding returns increase total required monthly goal contributions "
            f"by ₹{monthly_diff:,.2f}/month across all goals."
        )

        differences = RecommendationDifferences(
            annual_return_drop=str(return_drop),
            monthly_savings_increase=monthly_diff,
            additional_reserve_needed=extra_reserve_needed,
            delay_impacts=delays,
            summary_explanation=summary,
        )

        return ConservativeComparisonResponse(
            plan_source=plan_source,
            notes=notes,
            original=orig_variant,
            conservative=cons_variant,
            differences=differences,
        )
    except ValueError as error:
        raise ApiError(422, "recommendation_calculation_failed", str(error)) from error
