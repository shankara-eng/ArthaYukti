from app.schemas.types import Amount, ApiModel, DecimalStr


class GoalRecommendationItem(ApiModel):
    goal_id: str
    label: str
    target_amount_today: Amount
    target_date: str
    status: str
    projected_completion: str | None = None
    delay_months: int = 0
    required_monthly_savings: Amount


class RecommendationVariant(ApiModel):
    name: str  # "original" | "conservative"
    label: str
    assumed_annual_return: DecimalStr
    recommended_reserve_months: int
    total_monthly_required: Amount
    on_track_count: int
    delayed_count: int
    goals: list[GoalRecommendationItem]


class RecommendationDifferences(ApiModel):
    annual_return_drop: DecimalStr
    monthly_savings_increase: Amount
    additional_reserve_needed: Amount
    delay_impacts: list[str]
    summary_explanation: str


class ConservativeComparisonResponse(ApiModel):
    plan_source: str  # "saved" (the signed-in user's saved plan) or "hypothetical" (a plan sent with the request)
    notes: list[str]
    original: RecommendationVariant
    conservative: RecommendationVariant
    differences: RecommendationDifferences
