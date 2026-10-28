"""AI help for Plan B. Signed-in only: these routes receive a person's own finances.

The model never decides a feasibility or a number. If it is off or fails, every other route keeps working.
"""

from fastapi import APIRouter, Depends, Request

from app import ratelimit
from app.ai.assist import explain_plan, interpret_situation
from app.ai.gemini import AIFailure, GeminiClient, ai_configured, get_gemini
from app.api.common import AUTH_RESPONSES
from app.api.deps import get_current_user
from app.db.models import User
from app.errors import ApiError, ErrorResponse
from app.schemas.ai_assist import (
    AIStatus,
    ExplainRequest,
    Explanation,
    SituationDraft,
    SituationRequest,
)

router = APIRouter(
    prefix="/ai",
    tags=["ai"],
    responses={
        **AUTH_RESPONSES,
        502: {"model": ErrorResponse, "description": "The AI service sent an unusable answer."},
        503: {"model": ErrorResponse, "description": "AI help is not available on this server."},
        504: {"model": ErrorResponse, "description": "The AI service did not answer in time."},
    },
)

# Per person, per ten minutes. The provider has its own limits; this keeps one account from using them all.
AI_LIMIT = 20
AI_WINDOW = 600


def _guard(request: Request, user: User) -> None:
    ratelimit.enforce(request, "ai", AI_LIMIT, AI_WINDOW, user.id)


@router.get("/status", response_model=AIStatus)
def status(user: User = Depends(get_current_user)) -> AIStatus:
    """Whether AI help is switched on. Never says why it is not, and never shows the key."""
    return AIStatus(available=ai_configured())


@router.post("/situation-draft", response_model=SituationDraft)
def situation_draft(
    req: SituationRequest,
    request: Request,
    user: User = Depends(get_current_user),
    client: GeminiClient = Depends(get_gemini),
) -> SituationDraft:
    """Read a description into a suggested form draft. Only the typed text and the month are sent out."""
    _guard(request, user)
    try:
        return interpret_situation(client, req.text, req.current_month)
    except AIFailure as failure:
        raise ApiError(failure.status_code, failure.code, failure.message) from None


@router.post("/explain-recovery", response_model=Explanation)
def explain_recovery(
    req: ExplainRequest,
    request: Request,
    user: User = Depends(get_current_user),
    client: GeminiClient = Depends(get_gemini),
) -> Explanation:
    """Explain a plan in words. The server evaluates the plan itself and gives the model only the results."""
    _guard(request, user)
    try:
        return explain_plan(client, req.input, req.language)[0]
    except AIFailure as failure:
        raise ApiError(failure.status_code, failure.code, failure.message) from None
