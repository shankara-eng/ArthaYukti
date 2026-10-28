import json
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.common import AUTH_RESPONSES
from app.api.deps import get_current_user, get_db
from app.api.household import get_risk_capacity
from app.db.models import HouseholdProfile, RiskAssessment, User
from app.schemas.risk import (
    RiskAssessmentHistoryItem,
    RiskAssessmentResponse,
    RiskAssessmentSubmitRequest,
    RiskCapacityLevel,
    RiskToleranceLevel,
)

router = APIRouter(prefix="/risk", tags=["risk-assessment"], responses=AUTH_RESPONSES)

LOSS_SCORES = {
    "sell_all": 1,
    "reduce_some": 2,
    "hold": 3,
    "invest_more": 4,
}

SAFETY_SCORES = {
    "protect": 1,
    "balance": 2,
    "grow": 3,
}

HORIZON_SCORES = {
    "short": 1,
    "medium_short": 2,
    "medium": 3,
    "long": 4,
}

LIMITATIONS = [
    "Educational self-assessment: illustrates general risk orientation and is not registered financial or investment advice.",
    "Calculations rely strictly on your self-reported inputs and recorded account balances.",
    "Past tolerance to market downturns does not guarantee future financial emotional comfort.",
    "Specific goal time horizons and required capital must always govern instrument suitability.",
]


def _evaluate_tolerance(loss: str, safety: str, horizon: str) -> tuple[int, RiskToleranceLevel, list[str]]:
    l_score = LOSS_SCORES.get(loss, 2)
    s_score = SAFETY_SCORES.get(safety, 2)
    h_score = HORIZON_SCORES.get(horizon, 2)
    total_score = l_score + s_score + h_score

    explanations: list[str] = []

    # Reaction to loss explanation
    if loss == "sell_all":
        explanations.append("A hypothetical 20% drop would prompt you to liquidate holdings, indicating strong sensitivity to capital loss.")
    elif loss == "reduce_some":
        explanations.append("A 20% drop would lead you to reduce positions, reflecting cautious portfolio rebalancing under stress.")
    elif loss == "hold":
        explanations.append("You are prepared to hold investments through short-term market cycles to allow recovery.")
    elif loss == "invest_more":
        explanations.append("You view market downturns as prospective accumulation opportunities, indicating high tolerance for volatility.")

    # Safety vs growth
    if safety == "protect":
        explanations.append("You strongly prioritize capital protection and stability over high returns.")
    elif safety == "balance":
        explanations.append("You prefer a balanced approach, seeking moderate growth while managing downside fluctuations.")
    elif safety == "grow":
        explanations.append("You seek aggressive long-term growth and are willing to accept substantial portfolio volatility.")

    # Time horizon
    if horizon == "short":
        explanations.append("An investment horizon under 1 year necessitates capital preservation in liquid instruments.")
    elif horizon == "medium_short":
        explanations.append("A 1–3 year horizon requires moderate caution to avoid recovering during an adverse market cycle.")
    elif horizon == "medium":
        explanations.append("A 3–7 year horizon provides reasonable runway to weather normal equity market cycles.")
    elif horizon == "long":
        explanations.append("A horizon exceeding 7 years allows compounding through multiple market phases.")

    if total_score <= 5:
        level: RiskToleranceLevel = "Conservative"
    elif total_score <= 8:
        level = "Moderate"
    else:
        level = "Aggressive"

    return total_score, level, explanations


def _evaluate_composite(
    tolerance: RiskToleranceLevel,
    capacity: RiskCapacityLevel,
) -> tuple[RiskToleranceLevel, str | None]:
    conflict_note: str | None = None

    if capacity == "Low" and tolerance == "Aggressive":
        conflict_note = (
            "Conflict detected: Your psychological tolerance is Aggressive, but your financial risk capacity is Low "
            "due to limited emergency reserves or committed debt obligations. Taking aggressive market risk could "
            "force premature liquidation during a downturn. We recommend a Conservative or Moderate stance until "
            "liquidity buffers are established."
        )
        return "Moderate", conflict_note

    if capacity == "Low" and tolerance == "Moderate":
        conflict_note = (
            "Advisory: Your risk capacity is Low due to tight liquidity reserves. Although you are comfortable with "
            "moderate volatility, maintaining defensive capital reserves should take precedence."
        )
        return "Conservative", conflict_note

    if capacity == "High" and tolerance == "Conservative":
        conflict_note = (
            "Observation: Your financial resilience and liquid runway are High, but your preference is Conservative. "
            "Your plan respects your psychological comfort; there is no obligation to take unnecessary volatility."
        )
        return "Conservative", conflict_note

    if capacity == "Not assessed":
        conflict_note = (
            "Household profile details have not been saved. Risk capacity could not be verified against actual liquid reserves."
        )
        return tolerance, conflict_note

    return tolerance, conflict_note


@router.post("/assessment", response_model=RiskAssessmentResponse)
def submit_risk_assessment(
    req: RiskAssessmentSubmitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RiskAssessmentResponse:
    """Submit responses to the guided risk questionnaire, calculate scores, and persist a historical assessment record."""
    total_score, tolerance, explanations = _evaluate_tolerance(
        req.loss_reaction, req.safety_growth, req.time_horizon
    )

    # Fetch capacity indicator
    capacity_res = get_risk_capacity(db=db, user=user)
    capacity: RiskCapacityLevel = capacity_res.risk_capacity_level

    composite_stance, conflict_note = _evaluate_composite(tolerance, capacity)

    now = datetime.now(UTC)
    answers_data = {
        "loss_reaction": req.loss_reaction,
        "safety_growth": req.safety_growth,
        "time_horizon": req.time_horizon,
    }

    record = RiskAssessment(
        id=str(uuid.uuid4()),
        user_id=user.id,
        scoring_version="v1.0",
        loss_reaction=req.loss_reaction,
        safety_growth=req.safety_growth,
        time_horizon=req.time_horizon,
        answers_json=json.dumps(answers_data),
        tolerance_score=total_score,
        risk_tolerance=tolerance,
        risk_capacity=capacity,
        composite_stance=composite_stance,
        explanations_json=json.dumps(explanations),
        conflict_note=conflict_note,
        completed_at=now,
        created_at=now,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return RiskAssessmentResponse(
        id=record.id,
        scoring_version=record.scoring_version,
        loss_reaction=record.loss_reaction,
        safety_growth=record.safety_growth,
        time_horizon=record.time_horizon,
        tolerance_score=record.tolerance_score,
        risk_tolerance=tolerance,
        risk_capacity=capacity,
        composite_stance=composite_stance,
        explanations=explanations,
        conflict_note=conflict_note,
        limitations=LIMITATIONS,
        completed_at=record.completed_at.isoformat(),
    )


def _profile_changed_since(db: Session, user: User, record: RiskAssessment) -> bool:
    profile = db.query(HouseholdProfile).filter(HouseholdProfile.user_id == user.id).first()
    if profile is None or profile.updated_at is None:
        return False
    edited, assessed = profile.updated_at, record.completed_at
    if edited.tzinfo is None:
        edited = edited.replace(tzinfo=assessed.tzinfo)
    if assessed.tzinfo is None:
        assessed = assessed.replace(tzinfo=edited.tzinfo)
    return edited > assessed


@router.get("/assessment/latest", response_model=RiskAssessmentResponse)
def get_latest_risk_assessment(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RiskAssessmentResponse:
    """Retrieve the most recent completed risk assessment for the signed-in user."""
    record = (
        db.query(RiskAssessment)
        .filter(RiskAssessment.user_id == user.id)
        .order_by(RiskAssessment.completed_at.desc())
        .first()
    )
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No completed risk assessment found for this user.",
        )

    try:
        explanations = json.loads(record.explanations_json)
    except Exception:
        explanations = []

    return RiskAssessmentResponse(
        id=record.id,
        scoring_version=record.scoring_version,
        loss_reaction=record.loss_reaction,
        safety_growth=record.safety_growth,
        time_horizon=record.time_horizon,
        tolerance_score=record.tolerance_score,
        risk_tolerance=record.risk_tolerance,  # type: ignore[arg-type]
        risk_capacity=record.risk_capacity,  # type: ignore[arg-type]
        composite_stance=record.composite_stance,  # type: ignore[arg-type]
        explanations=explanations,
        conflict_note=record.conflict_note,
        limitations=LIMITATIONS,
        completed_at=record.completed_at.isoformat(),
        profile_changed_since=_profile_changed_since(db, user, record),
    )


@router.get("/assessment/history", response_model=list[RiskAssessmentHistoryItem])
def get_risk_assessment_history(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[RiskAssessmentHistoryItem]:
    """Retrieve prior risk assessment results without overwriting previous history."""
    records = (
        db.query(RiskAssessment)
        .filter(RiskAssessment.user_id == user.id)
        .order_by(RiskAssessment.completed_at.desc())
        .all()
    )
    return [
        RiskAssessmentHistoryItem(
            id=r.id,
            scoring_version=r.scoring_version,
            tolerance_score=r.tolerance_score,
            risk_tolerance=r.risk_tolerance,
            risk_capacity=r.risk_capacity,
            composite_stance=r.composite_stance,
            completed_at=r.completed_at.isoformat(),
        )
        for r in records
    ]
