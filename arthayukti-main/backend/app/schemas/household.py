import re
from decimal import Decimal
from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.schemas.types import (
    Amount,
    ApiModel,
    DecimalStr,
    Money,
    OptionalShortText,
    ShortText,
)

HouseholdType = Literal["single_earner", "dual_earner", "retiree"]
JobStability = Literal["high", "stable", "moderate", "variable"]
DependantRelationship = Literal["child", "spouse", "parent", "sibling", "other"]

MaritalStatus = Literal["married", "not_married"]
HousingStatus = Literal["own_house", "rented_house"]
EmploymentStatus = Literal[
    "salaried", "self_employed", "business_owner", "student", "unemployed", "retired", "other"
]
FamilySupportStatus = Literal["yes", "no", "unsure"]
FinancialDependantsCount = Literal["none", "one", "two", "three", "four_or_more"]
DebtType = Literal[
    "no_debt", "home_loan", "education_loan", "personal_loan", "vehicle_loan", "other", "multiple"
]
EmergencyFundCoverage = Literal["none", "less_than_3", "3_to_6", "more_than_6", "not_sure"]
IncomePredictability = Literal[
    "very_predictable", "mostly_predictable", "varies_significantly", "seasonal_project", "no_income", "not_sure"
]
InsuranceStatus = Literal["yes", "no", "not_sure"]


class DependantDetail(ApiModel):
    name: ShortText
    relationship: DependantRelationship
    age: int = Field(ge=0, le=120)
    annual_support_cost: Money = Field(default=Decimal("0.00"))
    notes: OptionalShortText | None = None


class PlannedLifeEvent(ApiModel):
    event_name: ShortText
    years_ahead: int = Field(ge=0, le=50)
    estimated_lump_sum_cost: Money = Field(default=Decimal("0.00"))
    ongoing_monthly_cost: Money = Field(default=Decimal("0.00"))
    description: OptionalShortText | None = None


class HouseholdProfileUpdateRequest(ApiModel):
    # Personal & Account
    full_name: str | None = Field(default=None, max_length=80)
    phone_number: str | None = Field(default=None, max_length=30)
    primary_earner_age: int | None = Field(default=None, ge=18, le=100)
    marital_status: MaritalStatus | None = None
    has_children: bool | None = None
    children_ages: list[int] | None = Field(default=None, max_length=15)

    # Family responsibilities
    supports_mother: FamilySupportStatus | None = None
    supports_father: FamilySupportStatus | None = None
    housing_status: HousingStatus | None = None
    employment_status: EmploymentStatus | None = None
    employment_other: str | None = Field(default=None, max_length=100)  # only with employment_status 'other'
    expected_retirement_age: int | None = Field(default=None, ge=30, le=100)

    # Financial resilience
    financial_dependants: FinancialDependantsCount | None = None
    debt_types: list[DebtType] | None = None
    emergency_fund_coverage: EmergencyFundCoverage | None = None
    income_predictability: IncomePredictability | None = None
    health_insurance_status: InsuranceStatus | None = None
    life_insurance_status: InsuranceStatus | None = None

    # Existing fields for backward compatibility
    household_type: HouseholdType | None = None
    dependants_count: int | None = Field(default=None, ge=0, le=20)
    children_count: int | None = Field(default=None, ge=0, le=15)
    elderly_dependants_count: int | None = Field(default=None, ge=0, le=10)
    monthly_family_support: Money | None = None
    job_stability: JobStability | None = None
    emergency_fund_months_target: int | None = Field(default=None, ge=3, le=24)
    dependants_details: list[DependantDetail] | None = None
    planned_events: list[PlannedLifeEvent] | None = None

    @field_validator("phone_number")
    @classmethod
    def validate_phone_number(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if v and not re.fullmatch(r"\+?[0-9][0-9 ()\-]{4,28}", v):
            raise ValueError("Phone number may contain only digits, spaces, hyphens, brackets and a leading +.")
        return v

    @model_validator(mode="after")
    def validate_children_consistency(self) -> "HouseholdProfileUpdateRequest":
        if self.has_children is False and self.children_ages:
            raise ValueError("Child ages cannot be given when 'has children' is No.")
        if self.has_children is True and self.children_ages is not None and len(self.children_ages) == 0:
            raise ValueError("Add at least one child age when 'has children' is Yes.")
        return self

    @field_validator("children_ages")
    @classmethod
    def validate_children_ages(cls, v: list[int] | None) -> list[int] | None:
        if v is not None:
            for age in v:
                if age < 0 or age > 100:
                    raise ValueError("Child age must be between 0 and 100.")
        return v

    @field_validator("debt_types")
    @classmethod
    def validate_debt_types(cls, v: list[DebtType] | None) -> list[DebtType] | None:
        if v is not None:
            if "no_debt" in v and len(v) > 1:
                raise ValueError("'No outstanding debt' cannot be selected together with other debt types.")
            if "multiple" in v and len(set(v)) > 1:
                raise ValueError("'Multiple' stands for several debts and cannot be combined with specific types.")
            return list(dict.fromkeys(v))
        return v


class HouseholdProfileResponse(ApiModel):
    """The details the person has provided. A field that was never provided is null, never a default."""

    is_saved: bool
    id: str | None
    user_email: str | None = None
    full_name: str | None = None
    phone_number: str | None = None

    primary_earner_age: int | None
    marital_status: str | None = None
    has_children: bool | None = None
    children_ages: list[int] = Field(default_factory=list)
    supports_mother: str | None = None
    supports_father: str | None = None
    housing_status: str | None = None
    employment_status: str | None = None
    employment_other: str | None = None
    expected_retirement_age: int | None = None

    financial_dependants: str | None = None
    debt_types: list[str] = Field(default_factory=list)
    emergency_fund_coverage: str | None = None
    income_predictability: str | None = None
    health_insurance_status: str | None = None
    life_insurance_status: str | None = None

    household_type: str | None
    dependants_count: int | None
    children_count: int | None
    elderly_dependants_count: int | None
    monthly_family_support: Amount | None
    job_stability: str | None
    emergency_fund_months_target: int | None
    dependants_details: list[DependantDetail]
    planned_events: list[PlannedLifeEvent]
    updated_at: str | None


class RiskCapacityIndicatorResponse(ApiModel):
    primary_earner_age: int | None
    household_type: str | None
    dependants_count: int | None
    monthly_commitments: Amount
    liquid_reserves: Amount
    reserve_coverage_months: DecimalStr
    recommended_reserve_months: int
    risk_capacity_level: Literal["Low", "Moderate", "High", "Not assessed"]
    explanation: list[str]
