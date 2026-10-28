from fastapi import APIRouter

from app.ai.orchestrator import consult_and_rescue, parse_natural_language_intent
from app.api.common import VALIDATION_RESPONSES
from app.schemas.rescue import (
    AIConsultRequest,
    AIConsultResponse,
    IntentSuggestions,
    ParseIntentRequest,
)

router = APIRouter(prefix="/ai", tags=["ai"], responses=VALIDATION_RESPONSES)


@router.post("/consult", response_model=AIConsultResponse)
def ai_consult(req: AIConsultRequest) -> AIConsultResponse:
    """Read a typed question into suggested goals and constraints, then run the deterministic
    rescue engine on the submitted plan. The reading step is keyword matching; every figure in
    the answer comes from the engine."""
    return AIConsultResponse.model_validate(
        consult_and_rescue(user_prompt=req.user_prompt, plan=req.plan, scenario=req.scenario)
    )


@router.post("/parse-intent", response_model=IntentSuggestions)
def ai_parse_intent(req: ParseIntentRequest) -> IntentSuggestions:
    """Pick suggested goals and constraints out of a typed question. Suggestions only."""
    parsed = parse_natural_language_intent(req.prompt)
    return IntentSuggestions(
        extraction_method="keyword_rules",
        identified_goals=parsed.identified_goals,
        detected_constraints=parsed.detected_constraints,
        missing_critical_info=parsed.missing_critical_info,
        plain_english_summary=parsed.plain_english_summary,
        plain_hindi_summary=parsed.plain_hindi_summary,
    )
