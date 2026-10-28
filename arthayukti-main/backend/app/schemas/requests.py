from pydantic import Field

from app.schemas.plan import Plan, PlanWithGoals
from app.schemas.scenario import Scenario
from app.schemas.types import ApiModel, Id, Label


class ProjectionRequest(ApiModel):
    plan: PlanWithGoals
    scenario: Scenario | None = None
    include_monthly: bool = True


class TradeoffRequest(ApiModel):
    plan: PlanWithGoals
    scenario: Scenario | None = None


class FixRequest(ApiModel):
    plan: PlanWithGoals
    scenario: Scenario | None = None


class CompareRequest(ApiModel):
    plan: PlanWithGoals
    scenarios: list[Scenario] = Field(min_length=2, max_length=3)


class PlanRecord(ApiModel):
    id: Id
    plan: Plan
    created_at: str
    updated_at: str


class PlanSummary(ApiModel):
    id: Id
    name: Label
    updated_at: str


class SampleSummary(ApiModel):
    id: Id
    name: Label
    description: str


class SampleDetail(SampleSummary):
    plan: Plan
    scenarios: list[Scenario]
