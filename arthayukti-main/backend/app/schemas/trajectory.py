"""Request and result of the Financial Trajectory (docs/FINANCIAL_TRAJECTORY.md).

Money is a decimal string on the wire. A result that cannot be fully projected is still a valid result: it carries its
`completeness`, `warnings` and `provenance` instead of failing.
"""

from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.plan import Plan
from app.schemas.scenario import Scenario
from app.schemas.types import (
    Amount,
    ApiModel,
    DecimalStr,
    GrowthRate,
    Id,
    Label,
    Money,
    Month,
    Rate,
)
from app.timeline import MAX_HORIZON_MONTHS

View = Literal["baseline", "selected_goals", "scenario"]
GoalEffectName = Literal["spend", "asset_purchase", "debt_reduction", "hold"]
ReturnRate = Annotated[DecimalStr, Field(ge=Decimal("-0.50"), le=Decimal("0.50"), max_digits=8, decimal_places=6)]


class Horizon(ApiModel):
    """How far to look: a number of months, or an age (which needs the reference age on the household profile)."""

    months: int | None = Field(default=None, ge=1, le=MAX_HORIZON_MONTHS)
    target_age: int | None = Field(default=None, ge=1, le=120)

    @model_validator(mode="after")
    def _one_of(self) -> "Horizon":
        if self.months is not None and self.target_age is not None:
            raise ValueError("Give the horizon as months or as a target age, not both.")
        return self


class ReturnAssumption(ApiModel):
    """A return the person chooses for one holding, account or policy (`holding`) or a whole class. Nothing is assumed
    for them: with none set, a value is held constant and the result says so."""

    scope: Literal["holding", "class"]
    key: str = Field(min_length=1, max_length=60)
    annual_rate: ReturnRate


class GoalEffect(ApiModel):
    """What a funded goal does to the balance sheet. A custom goal's effect is never guessed from its name."""

    goal_id: Id
    effect: GoalEffectName
    liability_id: str | None = None

    @model_validator(mode="after")
    def _debt_needs_a_debt(self) -> "GoalEffect":
        if (self.effect == "debt_reduction") != (self.liability_id is not None):
            raise ValueError("A debt reduction needs liability_id, and only a debt reduction takes one.")
        return self


class PlannedEvent(ApiModel):
    id: Id
    month: Month
    kind: Literal["investment_purchase", "deposit_maturity"]
    label: Label
    amount: Money | None = None
    charges: Money = Decimal("0.00")
    account_id: str | None = None
    maturity_amount: Money | None = None

    @model_validator(mode="after")
    def _fields_for_kind(self) -> "PlannedEvent":
        if self.kind == "investment_purchase":
            if self.amount is None or self.amount <= 0:
                raise ValueError("An investment purchase needs an amount above zero.")
            if self.account_id is not None or self.maturity_amount is not None:
                raise ValueError("An investment purchase takes no account or maturity amount.")
        else:
            if self.account_id is None:
                raise ValueError("A deposit maturity needs the account that matures.")
            if self.amount is not None or self.charges != 0:
                raise ValueError("A deposit maturity takes only maturity_amount (its documented maturity value).")
        return self


class LinkedCommitment(ApiModel):
    """Says a loan payment in the plan is the same loan as a recorded debt, so it is counted once (as the debt)."""

    commitment_id: Id
    liability_id: str


class TrajectoryRequest(BaseModel):
    """`plan_id` uses the signed-in user's saved plan; `plan` projects an explicit hypothetical plan.

    The balance sheet always comes from the person's own records. `view`: baseline (current income, spending,
    commitments and owned assets and debts, no future goals), selected_goals (baseline plus the goals named in
    `selected_goal_ids` and their funding), or scenario (the same plus the `scenario` shocks)."""

    plan_id: str | None = None
    plan: Plan | None = None
    horizon: Horizon = Field(default_factory=Horizon)
    view: View = "baseline"
    selected_goal_ids: list[Id] = Field(default_factory=list, max_length=8)
    scenario: Scenario | None = None
    include_monthly_ledger: bool = True
    include_events: bool = True
    return_assumptions: list[ReturnAssumption] = Field(default_factory=list, max_length=50)
    premium_growth_annual: GrowthRate = Decimal("0.000000")
    # The general inflation used to restate net worth in today's money. None: no inflation adjustment is shown.
    inflation_annual: Rate | None = None
    premiums_in_spending: Literal["auto", "yes", "no"] = "auto"
    # "plan": the plan's own expense lines (the default). "expenditure_plans": the plans on the Expenditure page.
    spending_source: Literal["plan", "expenditure_plans"] = "plan"
    linked_commitments: list[LinkedCommitment] = Field(default_factory=list, max_length=6)
    goal_effects: list[GoalEffect] = Field(default_factory=list, max_length=8)
    planned_events: list[PlannedEvent] = Field(default_factory=list, max_length=20)
    input_snapshot_hash: str | None = Field(default=None, min_length=64, max_length=64, pattern=r"^[0-9a-f]{64}$")

    @model_validator(mode="after")
    def _consistent(self) -> "TrajectoryRequest":
        if (self.plan_id is None) == (self.plan is None):
            raise ValueError("Send either plan_id (a saved plan) or plan (a hypothetical plan), not both or neither.")
        if self.view == "selected_goals" and not self.selected_goal_ids:
            raise ValueError("Choose at least one goal for the selected-goals view.")
        if self.view == "baseline" and self.selected_goal_ids:
            raise ValueError("The baseline excludes future goals. Use the selected-goals view to include them.")
        if self.view == "scenario" and self.scenario is None:
            raise ValueError("The scenario view needs a scenario.")
        if self.view != "scenario" and self.scenario is not None:
            raise ValueError("A scenario is only used with the scenario view.")
        if len(set(self.selected_goal_ids)) != len(self.selected_goal_ids):
            raise ValueError("A goal can be selected once.")
        return self


class Balances(ApiModel):
    cash: Amount
    deposits_and_investment_accounts: Amount
    market_investments: Amount
    retirement_and_fixed_income: Amount
    physical_and_other_assets: Amount
    insurance_fund_value: Amount
    goal_funds: Amount
    total_assets: Amount
    loans: Amount
    unfunded_shortfall: Amount
    total_liabilities: Amount
    net_worth: Amount


class TrajectoryEvent(ApiModel):
    month: Month
    kind: str
    label: str
    source_id: str | None
    cash_delta: Amount
    asset_delta: Amount
    liability_delta: Amount
    net_worth_effect: Amount
    principal: Amount | None
    interest: Amount | None
    note: str


class LedgerMonth(ApiModel):
    month: Month
    opening_balances: Balances
    income_events: list[TrajectoryEvent]
    expense_events: list[TrajectoryEvent]
    debt_events: list[TrajectoryEvent]
    insurance_events: list[TrajectoryEvent]
    investment_events: list[TrajectoryEvent]
    deposit_events: list[TrajectoryEvent]
    goal_events: list[TrajectoryEvent]
    other_events: list[TrajectoryEvent]
    closing_balances: Balances
    net_worth: Amount
    uncovered_cash_deficit: Amount


class Checkpoint(ApiModel):
    month: Month
    months_ahead: int
    age: int | None
    assets: Amount
    liabilities: Amount
    net_worth: Amount
    cash: Amount
    net_worth_real: Amount | None = None  # net_worth / (1 + inflation)^(months_ahead / 12), when an inflation rate was given


class YearlyGroup(ApiModel):
    group: str  # income | expense | debt | insurance | investment | deposit | goal | other
    cash_in: Amount
    cash_out: Amount
    net_worth_effect: Amount


class YearlyRow(ApiModel):
    """One calendar year of the horizon, built from the monthly ledger and nothing else."""

    year: int
    months_included: int
    age: int | None  # at the end of the year
    opening_cash: Amount
    closing_cash: Amount
    cash_in: Amount
    cash_out: Amount
    interest_paid: Amount
    principal_repaid: Amount
    groups: list[YearlyGroup]
    closing_market_investments: Amount
    closing_deposits_and_accounts: Amount
    closing_retirement_and_fixed_income: Amount
    closing_physical_and_other_assets: Amount
    closing_total_assets: Amount
    closing_total_liabilities: Amount
    opening_net_worth: Amount
    closing_net_worth: Amount
    net_worth_change: Amount
    closing_net_worth_real: Amount | None = None
    reconciles: bool  # the year's net-worth change equals the sum of its events' net-worth effects


class DebtFreeDate(ApiModel):
    id: str
    name: str
    month: Month | None
    status: str
    reason: str | None
    balance_now: Amount
    interest_in_period: Amount


class TrajectorySummary(ApiModel):
    current_assets: Amount
    current_liabilities: Amount
    current_net_worth: Amount
    current_cash: Amount
    horizon_assets: Amount
    horizon_liabilities: Amount
    horizon_net_worth: Amount
    horizon_cash: Amount
    inflation_annual: Amount | None = None
    horizon_net_worth_real: Amount | None = None  # today's purchasing power
    projected_debt_free_dates: list[DebtFreeDate]
    all_debts_cleared_month: Month | None
    reconciles: bool


class Drivers(ApiModel):
    income: Amount
    spending: Amount
    interest_paid: Amount
    principal_repaid: Amount
    premiums_paid: Amount
    benefits_received: Amount
    goal_spending: Amount
    market_growth: Amount
    goal_growth: Amount
    investment_charges: Amount
    shortfall: Amount


class GoalImpact(ApiModel):
    goal_id: str
    label: str
    type: str
    status: str
    target_date: Month
    projected_completion: Month | None
    delay_months: int | None
    effect: str
    effect_month: Month | None


class Comparison(ApiModel):
    baseline_horizon_net_worth: Amount
    baseline_horizon_cash: Amount
    net_worth_difference: Amount
    cash_difference: Amount


class MissingItem(ApiModel):
    record: str
    record_id: str | None
    field: str
    reason: str
    edit_route: str


class Completeness(ApiModel):
    status: Literal["complete", "partial", "insufficient"]
    recorded: bool
    stale_quotes: int
    missing: list[MissingItem]


class TrajectoryWarning(ApiModel):
    code: str
    severity: Literal["info", "warning", "critical"]
    message: str
    component: str
    record_id: str | None
    edit_route: str | None
    related_id: str | None = None  # a second record the warning is about (for example the plan loan payment)


class EffectiveAssumption(ApiModel):
    id: str
    label: str
    value: str
    kind: Literal["plan", "user_assumed", "default_rule"]
    source: str
    edit_route: str | None


class ProvenanceEntry(ApiModel):
    component: str
    label: str
    kind: Literal["user_entered", "provider_fetched", "computed", "assumed"]
    source: str | None
    detail: str | None
    as_of: str | None


class TrajectoryResult(ApiModel):
    model_version: str
    as_of: Month
    horizon_months: int
    view: View
    input_snapshot_hash: str
    reference_age: int | None
    effective_assumptions: list[EffectiveAssumption]
    completeness: Completeness
    warnings: list[TrajectoryWarning]
    provenance: list[ProvenanceEntry]
    summary: TrajectorySummary
    drivers: Drivers
    goals: list[GoalImpact]
    comparison: Comparison | None
    checkpoints: list[Checkpoint]
    yearly: list[YearlyRow] = Field(default_factory=list)
    opening_balances: Balances
    monthly_ledger: list[LedgerMonth] | None
