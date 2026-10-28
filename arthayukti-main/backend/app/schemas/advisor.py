"""Request and response shapes of the AI Financial Advisor (docs/AI_ADVISOR.md).

Money is a decimal string on the wire. Every figure in a response comes from the calculation engine; the model's
words only point at them (by scenario id), never carry new ones.
"""

from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import Field

from app.schemas.types import Amount, ApiModel, DecimalStr, Id, Label, Month, PositiveMoney

GoalStatus = Literal["achievable", "at_risk", "underfunded", "cannot_assess"]
Severity = Literal["info", "warning", "critical"]
Priority = Literal["high", "medium", "low"]
Category = Literal["spending", "investment", "goal_timing", "goal_amount", "debt", "income", "assumption", "combined", "other"]
DecisionStatus = Literal["proposed", "saved", "accepted", "dismissed", "completed"]
Language = Literal["en", "hi"]
Percent = Annotated[DecimalStr, Field(gt=0, le=100, max_digits=6, decimal_places=2)]
SmallPercent = Annotated[DecimalStr, Field(ge=0, le=30, max_digits=6, decimal_places=2)]
YearlyRate = Annotated[DecimalStr, Field(ge=Decimal("-0.10"), le=Decimal("0.30"), max_digits=8, decimal_places=6)]


# --- scenario requests ------------------------------------------------------------------------------------------------


class ExpenseChangeRequest(ApiModel):
    tool: Literal["simulate_expense_change"]
    percent: Percent | None = None
    amount: PositiveMoney | None = None
    categories: list[Label] = Field(default_factory=list, max_length=20)
    start_month: Month | None = None
    duration_months: int | None = Field(default=None, ge=1, le=240)


class InvestmentChangeRequest(ApiModel):
    tool: Literal["simulate_investment_change"]
    amount: PositiveMoney
    frequency: Literal["monthly", "quarterly"] = "monthly"
    start_month: Month | None = None
    duration_months: int | None = Field(default=None, ge=1, le=240)
    step_up_percent: SmallPercent = Decimal("0")


class GoalChangeRequest(ApiModel):
    tool: Literal["simulate_goal_change"]
    goal_id: Id
    target_date: Month | None = None
    target_amount_today: PositiveMoney | None = None


class DebtStrategyRequest(ApiModel):
    tool: Literal["simulate_debt_strategy"]
    loan_id: str = Field(min_length=1, max_length=60)
    extra: PositiveMoney
    kind: Literal["monthly", "one_time"] = "monthly"
    start_month: Month | None = None
    duration_months: int | None = Field(default=None, ge=1, le=240)


class AssumptionChangeRequest(ApiModel):
    tool: Literal["simulate_assumption_change"]
    name: Literal["savings_return_annual", "general_inflation_annual", "income_growth_annual", "expense_growth_annual"]
    new_value: YearlyRate


ScenarioRequestBody = Annotated[
    ExpenseChangeRequest | InvestmentChangeRequest | GoalChangeRequest | DebtStrategyRequest | AssumptionChangeRequest,
    Field(discriminator="tool"),
]


class ScenarioRequest(ApiModel):
    analysis_id: str = Field(min_length=1, max_length=40)
    change: ScenarioRequestBody


class AdvisorCompareRequest(ApiModel):
    analysis_id: str = Field(min_length=1, max_length=40)
    scenario_ids: list[str] = Field(min_length=1, max_length=6)


# --- results ----------------------------------------------------------------------------------------------------------


class OtherGoalEffect(ApiModel):
    goal_id: str
    label: str
    status_before: GoalStatus
    status_after: GoalStatus


class GoalAssessment(ApiModel):
    target_date: Month
    target_amount_today: Amount
    target_at_date: Amount | None
    available_funding: Amount | None
    funding_gap: Amount | None
    required_monthly: Amount | None
    projected_completion: Month | None
    delay_months: int | None
    status: GoalStatus
    reasons: list[str]
    effects_on_others: list[OtherGoalEffect]


class GoalDateComparison(ApiModel):
    goal_id: str
    label: str
    type: str
    priority: int
    saved_target_date: Month
    target_definition: Literal["today_money", "nominal"]
    original: GoalAssessment
    plus_3_years: GoalAssessment
    time_sensitive: bool
    caveats: list[str]


class GoalMini(ApiModel):
    goal_id: str
    label: str
    status: GoalStatus
    target_date: Month
    projected_completion: Month | None
    funding_gap: Amount


class DebtFree(ApiModel):
    name: str
    month: Month | None


class PathMetrics(ApiModel):
    monthly_surplus: Amount | None
    minimum_cash: Amount
    minimum_cash_month: Month
    uncovered_cash_months: int
    horizon_net_worth: Amount
    horizon_net_worth_real: Amount | None
    goals_achievable: int
    goals_total: int
    total_funding_gap: Amount
    goals: list[GoalMini]
    debt_free: list[DebtFree]


class GoalChange(ApiModel):
    goal_id: str
    label: str
    status_before: GoalStatus
    status_after: GoalStatus
    gap_change: Amount


class Deltas(ApiModel):
    monthly_surplus: Amount | None
    minimum_cash: Amount | None
    horizon_net_worth: Amount | None
    horizon_net_worth_real: Amount | None
    total_funding_gap: Amount | None
    goals_achievable: int
    uncovered_cash_months: int
    goal_changes: list[GoalChange]


class ProposedChange(ApiModel):
    """One exact edit to a record the person owns. Nothing is applied until they confirm this exact list."""

    record: Literal["goal", "expense"]
    id: str
    label: str
    field: str
    before: str
    after: str


class ScenarioResult(ApiModel):
    id: str
    analysis_id: str
    snapshot_id: str
    model_version: str
    tool: str
    title: str
    inputs: dict[str, Any]
    assumptions: list[str]
    feasible: bool
    violations: list[str]
    goal_effects_modelled: bool
    metrics: PathMetrics
    baseline_metrics: PathMetrics
    deltas: Deltas
    details: dict[str, Any]
    proposed_changes: list[ProposedChange]


class AdvisorCompareResult(ApiModel):
    analysis_id: str
    snapshot_id: str
    validation_status: Literal["valid", "mixed_snapshots"]
    baseline: PathMetrics
    scenarios: list[ScenarioResult]


# --- the report -------------------------------------------------------------------------------------------------------


class KeyFinding(ApiModel):
    id: str
    text: str
    severity: Severity
    metric_ref: str | None = None


class Recommendation(ApiModel):
    id: str
    title: str
    category: Category
    priority: Priority
    action: str
    rationale: str
    steps: list[str]
    risks: list[str]
    confidence: Literal["low", "medium", "high"]
    scenario_id: str | None
    calculated: bool  # true when a stored scenario result backs it
    source: Literal["engine", "ai"]
    status: DecisionStatus = "proposed"
    has_source_changes: bool = False


class Tradeoff(ApiModel):
    recommendation_id: str | None = None
    improves: list[str]
    worsens: list[str]
    affected: str


class AssumptionNote(ApiModel):
    label: str
    value: str
    source: str
    period: str | None = None


class ActionStep(ApiModel):
    step: str
    timing: str | None = None
    requires_confirmation: Literal[True] = True


class AdvisorTrajectoryYear(ApiModel):
    year: int
    closing_cash: Amount
    closing_assets: Amount
    closing_liabilities: Amount
    closing_net_worth: Amount
    closing_net_worth_real: Amount | None = None


class DataQuality(ApiModel):
    missing_fields: list[str]
    stale_values: list[str]
    assumptions: list[str]
    conflicts: list[str]
    completeness: Literal["complete", "partial", "insufficient"]


class ValidationNote(ApiModel):
    code: str
    message: str


class AdvisorReport(ApiModel):
    overall_summary: str
    key_findings: list[KeyFinding]
    recommendations: list[Recommendation]
    tradeoffs: list[Tradeoff]
    assumptions: list[AssumptionNote]
    data_gaps: list[str]
    follow_up_questions: list[str]
    action_plan: list[ActionStep]
    uncertainty: str


class AnalysisSummaryOut(ApiModel):
    id: str
    snapshot_id: str
    created_at: str
    stale: bool
    ai_used: bool


class AnalysisOut(ApiModel):
    id: str
    analysis_id: str
    snapshot_id: str
    snapshot_hash: str
    plan_id: str
    plan_name: str
    model_version: str
    prompt_version: str
    created_at: str
    as_of: Month
    currency: Literal["INR"]
    horizon_months: int
    stale: bool
    stale_reason: str | None
    ai_used: bool
    ai_status: Literal["not_requested", "not_configured", "ok", "failed", "invalid_output"]
    ai_message: str | None
    data_quality: DataQuality
    baseline_metrics: PathMetrics
    trajectory_years: list[AdvisorTrajectoryYear]
    goal_date_comparison: list[GoalDateComparison]
    report: AdvisorReport
    scenarios: list[ScenarioResult]
    validation_notes: list[ValidationNote]
    disclaimer: str


class AnalyzeRequest(ApiModel):
    plan_id: str | None = Field(default=None, max_length=36)
    language: Language = "en"
    use_ai: bool = True


class DecisionRequest(ApiModel):
    status: DecisionStatus
    # To change a record, the person confirms the exact changes: the token comes from the preview.
    apply_changes: bool = False
    confirm_token: str | None = Field(default=None, min_length=64, max_length=64)


class DecisionOut(ApiModel):
    recommendation_id: str
    status: DecisionStatus
    proposed_changes: list[ProposedChange]
    confirm_token: str | None
    needs_confirmation: bool
    applied: bool
    stale_after: bool


class ChatRequest(ApiModel):
    analysis_id: str = Field(min_length=1, max_length=40)
    message: str = Field(min_length=1, max_length=500)
    language: Language = "en"


class ChatResponse(ApiModel):
    answer: str
    scenario_ids: list[str]
    scenarios: list[ScenarioResult]
    ai_used: bool
    notice: str
