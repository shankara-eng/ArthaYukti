from typing import Any, Literal

from pydantic import Field

from app.schemas.types import (
    Amount,
    ApiModel,
    Code,
    DecimalStr,
    IdempotencyKey,
    IsoDate,
    LongText,
    Money,
    OptionalShortText,
    Rate,
    ShortText,
)

EscalationType = Literal[
    "none",
    "fixed_percentage",
    "fixed_amount",
    "step_up",
    "inflation_linked",
    "life_event_enhancement",
    "bonus_accrual",
]

EscalationFrequency = Literal["annual", "every_5_years", "policy_anniversary", "custom"]
PolicyType = Literal["term_life", "health", "ulip", "endowment_money_back", "motor", "home"]


class PolicyCreateRequest(ApiModel):
    policy_number: Code
    policy_type: PolicyType
    insurer_name: ShortText
    plan_name: ShortText
    start_date: IsoDate
    renewal_date: IsoDate | None = None
    expiry_date: IsoDate | None = None
    base_sum_assured: Money
    premium_amount: Money
    premium_frequency: Literal["annual", "monthly", "quarterly"] = "annual"
    status: Literal["active", "lapsed", "expired"] = "active"
    policy_details: dict[str, Any] | None = None


class PolicyResponse(ApiModel):
    id: str
    policy_number: str
    policy_type: str
    insurer_name: str
    plan_name: str
    start_date: str
    renewal_date: str | None
    expiry_date: str | None
    base_sum_assured: Amount
    current_effective_sum_assured: Amount
    premium_amount: Amount
    premium_frequency: str
    status: str
    policy_details: dict[str, Any] | None
    created_at: str
    updated_at: str


class EscalationCreateRequest(ApiModel):
    policy_id: str
    escalation_type: EscalationType
    escalation_rate: Rate | None = None
    fixed_escalation_amount: Money | None = None
    escalation_frequency: EscalationFrequency = "annual"
    custom_interval_months: int | None = Field(default=None, ge=1, le=600)
    first_escalation_date: IsoDate | None = None
    maximum_total_cover: Money | None = None
    maximum_increase_percentage: Rate | None = None
    maximum_cover_multiple: DecimalStr | None = None
    premium_increases_with_cover: bool = False
    premium_change_rule: OptionalShortText | None = None
    medical_underwriting_required: bool = False
    age_limit: int | None = Field(default=None, ge=1, le=120)
    escalation_terms: LongText | None = None
    notes: LongText | None = None


class EscalationResponse(ApiModel):
    id: str
    policy_id: str
    escalation_type: str
    base_sum_assured: Amount
    current_effective_sum_assured: Amount
    escalation_rate: Amount | None
    fixed_escalation_amount: Amount | None
    escalation_frequency: str
    custom_interval_months: int | None
    first_escalation_date: str | None
    next_escalation_date: str | None
    maximum_total_cover: Amount | None
    maximum_increase_percentage: Amount | None
    maximum_cover_multiple: Amount | None
    premium_increases_with_cover: bool
    medical_underwriting_required: bool
    age_limit: int | None
    escalation_status: str
    notes: str | None
    created_at: str
    updated_at: str


class ProcessEscalationEventRequest(ApiModel):
    event_type: Code = "scheduled_escalation"
    effective_date: IsoDate | None = None
    idempotency_key: IdempotencyKey | None = None
    notes: LongText | None = None


class EscalationHistoryResponse(ApiModel):
    id: str
    escalation_id: str
    policy_id: str
    effective_date: str
    event_type: str
    prior_cover: Amount
    increase_amount: Amount
    resulting_cover: Amount
    premium_before: Amount | None
    premium_after: Amount | None
    underwriting_requirement: str | None
    source: str
    idempotency_key: str
    created_at: str


class InsuranceDashboardSummary(ApiModel):
    total_base_cover: Amount
    total_effective_cover: Amount
    total_cover_growth: Amount
    next_increase_amount: Amount | None
    next_increase_date: str | None
    maximum_possible_cover: Amount | None
    health_ncb_total: Amount
    effective_health_sum_insured: Amount
    upcoming_alerts_count: int


class InsuranceReminderItem(ApiModel):
    id: str
    policy_id: str
    reminder_type: str
    due_date: str
    message: str
    is_acknowledged: bool
