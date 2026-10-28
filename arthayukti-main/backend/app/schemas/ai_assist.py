"""Request and response shapes for the AI help endpoints.

The answers carry `generated: true` so the page can label them. Figures in an explanation are the ones the
calculation engine produced; the model only words them.
"""

import re
from decimal import Decimal
from typing import Literal

from pydantic import Field, field_validator

from app.config import settings
from app.schemas.recovery import RecoveryInput
from app.schemas.types import ApiModel

_MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


class AIStatus(ApiModel):
    available: bool


class SituationRequest(ApiModel):
    text: str
    current_month: str  # so "from next month" can be resolved against the person's own calendar

    @field_validator("text")
    @classmethod
    def _text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Describe what changed in a sentence or two.")
        if len(value) > settings.AI_MAX_INPUT_CHARS:
            raise ValueError(f"Keep it under {settings.AI_MAX_INPUT_CHARS} characters.")
        return value

    @field_validator("current_month")
    @classmethod
    def _month(cls, value: str) -> str:
        if not _MONTH.match(value):
            raise ValueError("Use the form YYYY-MM.")
        return value


class SituationDraft(ApiModel):
    """A suggestion to put into the form. Every field may be empty, and the person confirms each one."""

    disruption: Literal["income_reduction", "income_loss", "new_expense"] | None
    start_month: str | None
    duration_months: int | None = Field(default=None, ge=1, le=120)
    income_before: Decimal | None = Field(default=None, ge=0)
    income_during: Decimal | None = Field(default=None, ge=0)
    new_monthly_cost: Decimal | None = Field(default=None, ge=0)
    cash_available: Decimal | None = Field(default=None, ge=0)
    cannot_change: list[str]  # what the person said must not change, in their words
    clarifications: list[str]  # what is still needed, worded by the server
    notice: str
    generated: Literal[True] = True


class ExplainRequest(ApiModel):
    input: RecoveryInput
    language: Literal["en", "hi"] = "en"


class Explanation(ApiModel):
    summary: str
    kept_as_is: list[str]
    changed: list[str]
    returns_to_plan: str
    caution: str
    notice: str
    generated: Literal[True] = True
