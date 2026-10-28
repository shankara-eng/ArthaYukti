"""Emergency-fund analysis. Signed-in only: the request carries a person's plan."""

from fastapi import APIRouter, Depends

from app.api.common import AUTH_RESPONSES
from app.api.deps import get_current_user
from app.db.models import User
from app.engine.emergency import analyze_emergency
from app.schemas.emergency import EmergencyAnalysis, EmergencyRequest

router = APIRouter(prefix="/emergency-fund", tags=["emergency-fund"], responses=AUTH_RESPONSES)


@router.post("/analyze", response_model=EmergencyAnalysis)
def analyze(req: EmergencyRequest, user: User = Depends(get_current_user)) -> EmergencyAnalysis:
    """What is held, the target in months of essentials, progress, and how the engine grows the reserve."""
    return analyze_emergency(req.plan, req.target_months, req.expenses, req.commitments, req.as_of)
