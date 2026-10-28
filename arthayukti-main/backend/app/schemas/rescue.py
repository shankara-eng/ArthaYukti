from decimal import Decimal
from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from app.schemas.plan import PlanWithGoals
from app.schemas.results import ProjectionSummary
from app.schemas.scenario import Scenario
from app.schemas.types import Amount, ApiModel, Money, Rate


class RescueRequest(ApiModel):
    plan: PlanWithGoals
    scenario: Scenario | None = None
    avoid_new_debt: bool = True
    min_emergency_reserve: Money = Decimal("0.00")
    max_delay_months: int = Field(default=24, ge=0, le=120)
    allow_discretionary_cut_pct: Rate = Decimal("0.20")
    allow_asset_sale: bool = False
    asset_sale_amount: Money = Decimal("0.00")
    housing_mode: Literal["rent_vs_buy"] | None = None
    transit_mode: Literal["transit_vs_car"] | None = None
    # Amounts the person states themselves. Without them the comparison is not offered.
    housing_monthly_saving: Money | None = None
    transit_monthly_saving: Money | None = None
    extra_monthly_budget: Money = Decimal("0.00")


class RescueAlternativeItem(ApiModel):
    alternative_id: str
    title: str
    description: str
    strategy: str
    is_feasible: bool
    scenario: Scenario
    result_summary: ProjectionSummary
    monthly_savings_change: Amount
    total_shortfall_today: Amount
    constraints_satisfied: list[str]
    constraints_violated: list[str]
    tradeoffs: list[str]
    assumptions: list[str]


class RescueResponse(ApiModel):
    is_baseline_feasible: bool
    baseline_summary: ProjectionSummary
    alternatives: list[RescueAlternativeItem]
    recommended_alternative_id: str | None
    unresolved_gap: Amount | None
    binding_constraint: str | None
    run_id: str
    ranking_criteria: str
    missing_information: list[str]
    assumptions: list[str]


class AIConsultRequest(ApiModel):
    user_prompt: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)
    ]
    plan: PlanWithGoals
    scenario: Scenario | None = None


class ParseIntentRequest(ApiModel):
    prompt: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


class GoalHint(ApiModel):
    type: str
    label: str
    target_amount_today: Amount


class IntentSuggestions(ApiModel):
    """Suggestions read out of a typed question by keyword rules. Not a calculation."""

    extraction_method: Literal["keyword_rules"]
    identified_goals: list[GoalHint]
    detected_constraints: list[str]
    missing_critical_info: list[str]
    plain_english_summary: str
    plain_hindi_summary: str


class AIAlternative(ApiModel):
    alternative_id: str
    title: str
    description: str
    strategy: str
    is_feasible: bool
    total_shortfall_today: Amount
    monthly_savings_change: Amount
    constraints_satisfied: list[str]
    constraints_violated: list[str]
    tradeoffs: list[str]
    assumptions: list[str]


class AIConsultResponse(ApiModel):
    intent: IntentSuggestions
    is_baseline_feasible: bool
    recommended_alternative_id: str | None
    binding_constraint: str | None
    unresolved_gap: Amount | None
    ranking_criteria: str
    missing_information: list[str]
    alternatives: list[AIAlternative]
    calculation_run_id: str
