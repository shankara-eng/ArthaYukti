from typing import Annotated

from pydantic import AfterValidator, Field, StringConstraints

from app.schemas.calculators import CalculatorConfig
from app.schemas.financials import (
    AccountResponse,
    InvestmentResponse,
    LiabilityResponse,
    TransactionResponse,
)
from app.schemas.household import HouseholdProfileResponse
from app.schemas.insurance import PolicyResponse
from app.schemas.ledger import TransactionCreate  # noqa: F401
from app.schemas.plan import Plan
from app.schemas.recovery_plan import AgreementDraft
from app.schemas.spending import CategoryOut, PlanOut, SettingsOut
from app.schemas.types import ApiModel, Rate

# bcrypt only reads the first 72 bytes, so longer passwords would be silently truncated.
MAX_PASSWORD_BYTES = 72
MIN_PASSWORD_LENGTH = 10

EMAIL_PATTERN = r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)+$"

Email = Annotated[
    str,
    StringConstraints(strip_whitespace=True, to_lower=True, max_length=254, pattern=EMAIL_PATTERN),
]


def _check_password_strength(value: str) -> str:
    if len(value.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise ValueError(f"Password must be at most {MAX_PASSWORD_BYTES} bytes long.")
    if not any(c.isalpha() for c in value) or not any(c.isdigit() for c in value):
        raise ValueError("Password must contain at least one letter and one digit.")
    return value


NewPassword = Annotated[
    str,
    Field(min_length=MIN_PASSWORD_LENGTH, max_length=MAX_PASSWORD_BYTES),
    AfterValidator(_check_password_strength),
]
LoginPassword = Annotated[str, Field(min_length=1, max_length=128)]
PersonName = Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)]


class SignupRequest(ApiModel):
    email: Email
    password: NewPassword
    full_name: PersonName = ""


class LoginRequest(ApiModel):
    email: Email
    password: LoginPassword


class UserProfile(ApiModel):
    id: str
    email: str
    full_name: str
    is_active: bool
    created_at: str


class AuthResponse(ApiModel):
    access_token: str
    token_type: str = "bearer"
    user: UserProfile


class PasswordResetRequest(ApiModel):
    email: Email


class PasswordResetConfirm(ApiModel):
    token: Annotated[str, Field(min_length=20, max_length=200)]
    new_password: NewPassword


class MessageResponse(ApiModel):
    message: str


class Preferences(ApiModel):
    """Settings that follow the person across the app."""

    default_inflation_annual: Rate
    is_default: bool  # true until the person sets their own


class PreferencesUpdate(ApiModel):
    default_inflation_annual: Rate


class ExportUser(ApiModel):
    id: str
    email: str
    full_name: str
    created_at: str
    default_inflation_annual: str | None = None


class ExportPlan(ApiModel):
    id: str
    name: str
    as_of: str
    plan: Plan


class ExportAccount(ApiModel):
    id: str
    name: str
    type: str
    balance: str
    details: AccountResponse


class ExportPolicy(ApiModel):
    id: str
    number: str
    type: str
    details: PolicyResponse


class ExportExpenditure(ApiModel):
    plans: list[PlanOut]
    categories: list[CategoryOut]
    settings: SettingsOut


class ExportCalculatorScenario(ApiModel):
    id: str
    name: str
    config: CalculatorConfig


class ExportInvestmentTransaction(ApiModel):
    id: str
    holding_id: str
    transaction_type: str
    trade_date: str
    quantity: str | None
    price: str | None
    fees: str
    ratio_new: int | None
    ratio_old: int | None
    notes: str | None


class ExportRecoveryAgreement(ApiModel):
    id: str
    name: str
    version: int
    draft: AgreementDraft


class ExportResponse(ApiModel):
    user: ExportUser
    plans: list[ExportPlan]
    accounts: list[ExportAccount]
    policies: list[ExportPolicy]
    investments: list[InvestmentResponse]
    liabilities: list[LiabilityResponse]
    transactions: list[TransactionResponse]
    household_profile: HouseholdProfileResponse
    calculator_scenarios: list[ExportCalculatorScenario] = []
    recovery_agreements: list[ExportRecoveryAgreement] = []
    investment_transactions: list[ExportInvestmentTransaction] = []
    expenditure: ExportExpenditure | None = None
