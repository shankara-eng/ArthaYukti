"""Plan B: the search request and result, the comparison of plans, and the Recovery Agreement.

The search and the comparison are deterministic: the same request always gives the same answer, and every number
shown comes from `evaluate_recovery`. Nothing here is advice or a guarantee.
"""

from decimal import Decimal
from typing import Annotated, Literal

from pydantic import Field, StringConstraints, model_validator

from app.schemas.recovery import (
    MAX_RECOVERY_MONTHS,
    Adjustment,
    RecoveryEvaluation,
    RecoveryInput,
)
from app.schemas.types import Amount, ApiModel, Id, Label, Money, Month, PositiveMoney
from app.timeline import month_to_index

MAX_AGREEMENTS = 30


class SearchLimits(ApiModel):
    """Explicit bounds on the search. Reaching `max_candidates` makes the answer incomplete, never "no solution"."""

    max_candidates: int = Field(default=1500, ge=1, le=20000)
    max_options: int = Field(default=3, ge=1, le=5)
    reduce_step: PositiveMoney = Decimal(
        "1000.00"
    )  # how finely a reduction is stepped between the original and the minimum


class RecoverySearchRequest(ApiModel):
    input: RecoveryInput  # `adjustments` must be empty: the search proposes them
    adjust_from: Month | None = (
        None  # first month a change may apply (default: the first modelled month)
    )
    adjust_months: int | None = Field(
        default=None, ge=1, le=MAX_RECOVERY_MONTHS
    )  # how long a fixed change lasts
    # Items whose adjustment the person refuses ("I cannot reduce this"). The search never touches them.
    excluded_item_ids: list[Id] = Field(default_factory=list, max_length=40)
    limits: SearchLimits = Field(default_factory=SearchLimits)

    @model_validator(mode="after")
    def _consistent(self) -> "RecoverySearchRequest":
        if self.input.adjustments:
            raise ValueError("Send the situation without adjustments: the search proposes them.")
        first = month_to_index(self.input.start_month)
        last = first + self.input.months - 1
        if self.adjust_from is not None and not first <= month_to_index(self.adjust_from) <= last:
            raise ValueError("adjust_from must fall inside the modelled months.")
        known = {i.id for i in self.input.items}
        unknown = [i for i in self.excluded_item_ids if i not in known]
        if unknown:
            raise ValueError(f"excluded_item_ids names unknown items: {', '.join(unknown)}.")
        return self


class SearchSummary(ApiModel):
    # found: at least one plan meets every rule. infeasible: the whole supported space was searched and none does.
    # incomplete: the candidate limit was reached before the space was searched and none was found.
    status: Literal["found", "infeasible", "incomplete"]
    complete: bool  # true only when every candidate in the supported space was evaluated
    space_size: int  # how many combinations the permitted changes allow
    evaluated: int
    duplicates_skipped: int
    errors: int  # candidates that could not be evaluated (a systemic problem if every one fails)
    feasible_found: int
    best_not_proven: bool  # true when feasible plans were found but the search was cut short
    rejected_by_kind: dict[str, int]
    ignored_permissions: list[str]  # permissions the search could not use, with the reason
    notes: list[str]


class AdjustmentDescription(ApiModel):
    adjustment: Adjustment
    text: str


class RejectedAlternative(ApiModel):
    adjustments: list[AdjustmentDescription]
    sacrifice_total: Amount
    kind: Literal["mandatory_shortfall", "reserve_floor", "pause_limit"]
    month: Month
    message: str


class PlanMetrics(ApiModel):
    minimum_liquid: Amount
    final_liquid: Amount
    floor_headroom: Amount  # lowest liquid cash minus the floor; never negative for a feasible plan
    flexible_reduction_total: Amount  # flexible spending not spent compared with the original
    goal_contributions_deferred: Amount  # contributions not made compared with the original
    goal_contributions_made: Amount
    paused_months: int  # item-months at zero
    reduced_months: int  # item-months below the original but above zero
    balances_end: dict[str, Amount]
    restoration_complete_month: (
        Month | None
    )  # when every changed item is back to its original amount
    goal_delay: str  # the existing goal engine cannot give a reliable delay for these plans


class PlanOption(ApiModel):
    id: str
    label: str
    rank: int
    adjustments: list[AdjustmentDescription]
    metrics: PlanMetrics
    evaluation: RecoveryEvaluation
    why_it_works: list[str]
    what_you_give_up: list[str]
    key_assumptions: list[str]
    what_would_break_it: list[str]


class InfeasibilityReport(ApiModel):
    """When no permitted plan works: the strongest plan you allow, and why it still falls short."""

    strongest_plan: list[AdjustmentDescription]
    first_violation: str
    shortfall: Amount  # the worst amount below the floor (or short of mandatory payments)
    conflicts: list[str]
    you_could_consider: list[str]  # changes the person might choose; none has been applied


class RecoverySearchResponse(ApiModel):
    search: SearchSummary
    options: list[PlanOption]  # at most `max_options`, genuinely different, best first
    ranking_policy: str
    trade_off_note: str | None
    rejected: list[RejectedAlternative]  # the simplest alternatives that failed, and why
    infeasibility: InfeasibilityReport | None
    frontier_size: int  # feasible plans that no other feasible plan beats on every month


# ---- agreements ------------------------------------------------------------------------------------------------

AgreementName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
]
Rationale = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]


class AgreementDraft(ApiModel):
    """What is saved: the situation, the chosen adjustments, restoration rules and the person's own words."""

    input: RecoveryInput  # includes the chosen adjustments, restoration rules and review month
    selected_label: Label | None = None  # which option the person picked
    rationale: Rationale = ""
    disruption_note: Rationale = ""
    source_plan_id: str | None = (
        None  # the saved plan this was started from, if any (never modified)
    )
    source_plan_name: str | None = None
    fallback_note: Rationale = ""  # what to do if recovery has not happened by the review date


class AgreementCreate(ApiModel):
    name: AgreementName
    draft: AgreementDraft
    client_token: Annotated[str, StringConstraints(min_length=8, max_length=64)] | None = None


class AgreementRevise(ApiModel):
    name: AgreementName | None = None
    draft: AgreementDraft
    expected_version: int = Field(
        ge=1
    )  # the version the person was looking at; a mismatch is refused
    change_note: Rationale = ""


class VersionSummary(ApiModel):
    version: int
    created_at: str
    change_note: str
    selected_label: str | None


class VersionChange(ApiModel):
    field: str
    before: str
    after: str


class AgreementOut(ApiModel):
    id: str
    name: str
    version: int
    created_at: str
    updated_at: str
    draft: AgreementDraft
    evaluation: RecoveryEvaluation  # always recomputed from the saved draft, never stored
    changes_from_previous: list[VersionChange]
    versions: list[VersionSummary]
    limitations: list[str]


class AgreementSummary(ApiModel):
    id: str
    name: str
    version: int
    updated_at: str
    feasible: bool
    review_month: Month | None


class ReviewRequest(ApiModel):
    """What is true now. The review recalculates from `as_of_month` using only these updated figures."""

    as_of_month: Month
    liquid_cash: Money
    monthly_income: Money  # assumed to continue to the end of the agreement
    recovery_confirmed: bool = False


class ReviewResult(ApiModel):
    as_of_month: Month
    fits: bool
    status: Literal["still_fits", "needs_recalculation"]
    evaluation: RecoveryEvaluation
    messages: list[str]
