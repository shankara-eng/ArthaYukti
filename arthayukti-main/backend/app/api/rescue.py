import hashlib

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.common import AUTH_RESPONSES
from app.api.deps import get_db, get_optional_user
from app.config import settings
from app.db.models import CalculationRun, User
from app.engine.rescue import run_rescue_analysis
from app.schemas.rescue import RescueAlternativeItem, RescueRequest, RescueResponse

router = APIRouter(prefix="/rescue", tags=["rescue"], responses=AUTH_RESPONSES)


@router.post("/analyze", response_model=RescueResponse)
def analyze_and_rescue(
    req: RescueRequest,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
) -> RescueResponse:
    """Run constraint-aware rescue analysis to solve competing multi-goal conflicts."""
    result = run_rescue_analysis(
        plan=req.plan,
        scenario=req.scenario,
        avoid_new_debt=req.avoid_new_debt,
        min_emergency_reserve=req.min_emergency_reserve,
        max_delay_months=req.max_delay_months,
        allow_discretionary_cut_pct=req.allow_discretionary_cut_pct,
        allow_asset_sale=req.allow_asset_sale,
        asset_sale_amount=req.asset_sale_amount,
        housing_mode=req.housing_mode,
        transit_mode=req.transit_mode,
        housing_monthly_saving=req.housing_monthly_saving,
        transit_monthly_saving=req.transit_monthly_saving,
        extra_monthly_budget=req.extra_monthly_budget,
    )

    # Record calculation run audit if user is available
    if user:
        inputs_str = (
            f"{req.plan.model_dump_json()}_{req.scenario.model_dump_json() if req.scenario else ''}"
        )
        inputs_hash = hashlib.sha256(inputs_str.encode("utf-8")).hexdigest()
        run_record = CalculationRun(
            user_id=user.id,
            run_type="rescue_analysis",
            inputs_hash=inputs_hash,
            summary_json=result.baseline_summary.model_dump_json(),
            assumptions_json=req.plan.assumptions.model_dump_json(),
            model_version=settings.MODEL_VERSION,
        )
        db.add(run_record)
        db.commit()

    return RescueResponse(
        is_baseline_feasible=result.is_baseline_feasible,
        baseline_summary=result.baseline_summary,
        alternatives=[
            RescueAlternativeItem(
                alternative_id=a.alternative_id,
                title=a.title,
                description=a.description,
                strategy=a.strategy,
                is_feasible=a.is_feasible,
                scenario=a.scenario,
                result_summary=a.result_summary,
                monthly_savings_change=a.monthly_savings_change,
                total_shortfall_today=a.total_shortfall_today,
                constraints_satisfied=a.constraints_satisfied,
                constraints_violated=a.constraints_violated,
                tradeoffs=a.tradeoffs_summary,
                assumptions=a.assumptions,
            )
            for a in result.alternatives
        ],
        recommended_alternative_id=result.recommended_alternative_id,
        unresolved_gap=result.unresolved_gap,
        binding_constraint=result.binding_constraint,
        run_id=result.run_id,
        ranking_criteria=result.ranking_criteria,
        missing_information=result.missing_information,
        assumptions=result.assumptions,
    )
