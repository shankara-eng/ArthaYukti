from typing import Literal

from app.schemas.types import ApiModel

LossReaction = Literal["sell_all", "reduce_some", "hold", "invest_more"]
SafetyGrowthPreference = Literal["protect", "balance", "grow"]
InvestmentHorizon = Literal["short", "medium_short", "medium", "long"]
RiskToleranceLevel = Literal["Conservative", "Moderate", "Aggressive"]
RiskCapacityLevel = Literal["Low", "Moderate", "High", "Not assessed"]


class RiskAssessmentSubmitRequest(ApiModel):
    loss_reaction: LossReaction
    safety_growth: SafetyGrowthPreference
    time_horizon: InvestmentHorizon


class RiskAssessmentResponse(ApiModel):
    id: str
    scoring_version: str
    loss_reaction: str
    safety_growth: str
    time_horizon: str
    tolerance_score: int
    risk_tolerance: RiskToleranceLevel
    risk_capacity: RiskCapacityLevel
    composite_stance: RiskToleranceLevel
    explanations: list[str]
    conflict_note: str | None = None
    limitations: list[str]
    completed_at: str
    # True when the profile was edited after this assessment, so its capacity reading may be out of date.
    profile_changed_since: bool = False


class RiskAssessmentHistoryItem(ApiModel):
    id: str
    scoring_version: str
    tolerance_score: int
    risk_tolerance: str
    risk_capacity: str
    composite_stance: str
    completed_at: str
