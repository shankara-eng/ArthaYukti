"""Plan B: the shapes the recovery evaluator, the search, the comparison and the agreement read and return.

Amounts are `Decimal` in rupees (two decimals, never negative),
months are 'YYYY-MM'. The evaluator never invents an input: every amount, month and permission
must be stated.
"""

from typing import Literal

from pydantic import Field, model_validator

from app.schemas.types import Amount, ApiModel, Id, Label, Money, Month
from app.timeline import index_to_month, month_to_index

MAX_RECOVERY_MONTHS = 120

ItemKind = Literal[
    "essential", "mandatory_debt", "protected_obligation", "flexible", "goal_contribution"
]
MANDATORY_KINDS = {"essential", "mandatory_debt", "protected_obligation"}


class IncomeSegment(ApiModel):
    """Net monthly income over a range. `to_month=None` means the end of the horizon, duration unknown."""

    from_month: Month
    to_month: Month | None = None
    monthly_net: Money


class CashItem(ApiModel):
    """A monthly outflow. Goal contributions are transfers to savings, not spending."""

    id: Id
    label: Label
    kind: ItemKind
    monthly: Money
    from_month: Month | None = None  # default: the whole horizon
    to_month: Month | None = None
    # Only for goal contributions: true means the person says it must not change.
    protected: bool = True
    # Only for goal contributions: the protected balance the transfer is credited to.
    balance_id: Id | None = None


class ProtectedBalance(ApiModel):
    """Money set aside for a goal or retirement. The evaluator never withdraws from it."""

    id: Id
    label: Label
    balance: Money


class Permission(ApiModel):
    """What the person allows to change. Without one, an item cannot be adjusted."""

    item_id: Id
    action: Literal["pause", "reduce_to"]
    min_monthly: Money | None = None  # for reduce_to: the lowest amount allowed
    max_months: int | None = Field(
        default=None, ge=1, le=MAX_RECOVERY_MONTHS
    )  # for pause: the longest allowed

    @model_validator(mode="after")
    def _needs_its_limit(self) -> "Permission":
        if self.action == "reduce_to" and self.min_monthly is None:
            raise ValueError("A reduction needs min_monthly, the lowest amount you allow.")
        if self.action == "pause" and self.max_months is None:
            raise ValueError("A pause needs max_months, the longest pause you allow.")
        return self


class Adjustment(ApiModel):
    """A change being tested: pause an item, or lower it, over a month range."""

    item_id: Id
    action: Literal["pause", "reduce_to"]
    from_month: Month
    # None means "until restored": the change lasts until the item's restoration rule is met.
    to_month: Month | None = None
    monthly: Money | None = None  # for reduce_to

    @model_validator(mode="after")
    def _shape(self) -> "Adjustment":
        if self.to_month is not None and month_to_index(self.to_month) < month_to_index(
            self.from_month
        ):
            raise ValueError("An adjustment cannot end before it starts.")
        if self.action == "reduce_to" and self.monthly is None:
            raise ValueError("A reduction needs the new monthly amount.")
        if self.action == "pause" and self.monthly is not None:
            raise ValueError("A pause has no monthly amount.")
        return self


class RestorationCondition(ApiModel):
    """One test that must hold before a paused or reduced item starts to come back."""

    type: Literal["income_at_least", "liquid_at_least", "user_confirmed", "date_reached"]
    amount: Money | None = (
        None  # income_at_least: monthly net income; liquid_at_least: cash at last month-end
    )
    month: Month | None = None  # date_reached

    @model_validator(mode="after")
    def _shape(self) -> "RestorationCondition":
        if self.type in ("income_at_least", "liquid_at_least") and self.amount is None:
            raise ValueError("That condition needs an amount.")
        if self.type == "date_reached" and self.month is None:
            raise ValueError("A date condition needs a month.")
        if self.type in ("user_confirmed",) and (self.amount is not None or self.month is not None):
            raise ValueError("A confirmation has no amount or month.")
        return self


class RestorationRule(ApiModel):
    """How an item that was paused or reduced "until restored" comes back.

    Every condition must hold (a date can be one of them, never the only one). `steps` are the monthly
    amounts to return to, in order; leave it empty to go straight back to the original amount. Each later step
    starts `step_gap_months` after the one before. With `affordability_guard` a step that would take liquid
    cash below the floor is deferred, not applied.
    """

    item_id: Id
    conditions: list[RestorationCondition] = Field(min_length=1, max_length=4)
    steps: list[Money] = Field(default_factory=list, max_length=6)
    step_gap_months: int = Field(default=1, ge=1, le=12)
    affordability_guard: bool = True

    @model_validator(mode="after")
    def _shape(self) -> "RestorationRule":
        if all(c.type == "date_reached" for c in self.conditions):
            raise ValueError(
                "A date alone cannot restore an item: add an income, cash or confirmation condition."
            )
        if any(b <= a for a, b in zip(self.steps, self.steps[1:], strict=False)):
            raise ValueError("Restoration steps must rise.")
        return self


class RecoveryInput(ApiModel):
    start_month: Month
    months: int = Field(ge=1, le=MAX_RECOVERY_MONTHS)
    liquid_cash: Money
    reserve_floor: Money
    income: list[IncomeSegment] = Field(min_length=1, max_length=12)
    items: list[CashItem] = Field(min_length=1, max_length=40)
    protected_balances: list[ProtectedBalance] = Field(default_factory=list, max_length=20)
    permissions: list[Permission] = Field(default_factory=list, max_length=40)
    adjustments: list[Adjustment] = Field(default_factory=list, max_length=40)
    restorations: list[RestorationRule] = Field(default_factory=list, max_length=40)
    # The person's own confirmation that recovery has happened. A review date never sets this.
    recovery_confirmed_from: Month | None = None
    # When to look again. It does not imply anything has recovered.
    review_month: Month | None = None

    @model_validator(mode="after")
    def _consistent(self) -> "RecoveryInput":
        first = month_to_index(self.start_month)
        last = first + self.months - 1

        def unique(kind: str, ids: list[str]) -> None:
            if len(set(ids)) != len(ids):
                raise ValueError(f"{kind} ids must be unique.")

        unique("Item", [i.id for i in self.items])
        unique("Protected balance", [b.id for b in self.protected_balances])
        balance_ids = {b.id for b in self.protected_balances}

        # Income must be stated for every month, once.
        covered: dict[int, int] = {}
        for segment in self.income:
            start = month_to_index(segment.from_month)
            end = month_to_index(segment.to_month) if segment.to_month else last
            if start < first or end > last or end < start:
                raise ValueError("Income segments must lie inside the modelled months.")
            for m in range(start, end + 1):
                covered[m] = covered.get(m, 0) + 1
        if any(covered.get(m, 0) != 1 for m in range(first, last + 1)):
            raise ValueError("Income must be stated for every modelled month, exactly once.")

        by_id = {i.id: i for i in self.items}
        for item in self.items:
            start = month_to_index(item.from_month) if item.from_month else first
            end = month_to_index(item.to_month) if item.to_month else last
            if start < first or end > last or end < start:
                raise ValueError(f"Item {item.id} must lie inside the modelled months.")
            if item.balance_id is not None and (
                item.kind != "goal_contribution" or item.balance_id not in balance_ids
            ):
                raise ValueError(
                    f"Item {item.id} names a balance that is not a protected balance, or is not a goal contribution."
                )

        perms = {(p.item_id, p.action): p for p in self.permissions}
        if len(perms) != len(self.permissions):
            raise ValueError("Each permission may be stated once.")
        for p in self.permissions:
            if p.item_id not in by_id:
                raise ValueError(f"Permission names an unknown item: {p.item_id}.")

        rules = {r.item_id: r for r in self.restorations}
        if len(rules) != len(self.restorations):
            raise ValueError("Each item may have one restoration rule.")
        for rule in self.restorations:
            item = by_id.get(rule.item_id)
            if item is None:
                raise ValueError(f"Restoration rule names an unknown item: {rule.item_id}.")
            if any(step > item.monthly for step in rule.steps):
                raise ValueError(
                    f"A restoration step cannot exceed the original amount of {item.label}."
                )
        if (
            self.review_month is not None
            and not first <= month_to_index(self.review_month) <= last + 1
        ):
            raise ValueError(
                "The review month must fall inside the modelled months or just after them."
            )
        if (
            self.recovery_confirmed_from is not None
            and not first <= month_to_index(self.recovery_confirmed_from) <= last
        ):
            raise ValueError("The confirmation month must fall inside the modelled months.")

        spans: dict[str, list[tuple[int, int]]] = {}
        paused: dict[str, int] = {}
        for a in self.adjustments:
            item = by_id.get(a.item_id)
            if item is None:
                raise ValueError(f"Adjustment names an unknown item: {a.item_id}.")
            adjustable = item.kind == "flexible" or (
                item.kind == "goal_contribution" and not item.protected
            )
            if not adjustable:
                raise ValueError(f"{item.label} is protected and cannot be adjusted.")
            perm = perms.get((a.item_id, a.action))
            if perm is None:
                raise ValueError(f"You have not allowed that change to {item.label}.")
            start = month_to_index(a.from_month)
            end = month_to_index(a.to_month) if a.to_month else last
            if a.to_month is None and a.item_id not in rules:
                raise ValueError(
                    f"{item.label} is changed until restored, so it needs a restoration rule."
                )
            if start < first or end > last:
                raise ValueError("Adjustments must lie inside the modelled months.")
            for s, e in spans.get(a.item_id, []):
                if start <= e and s <= end:
                    raise ValueError(f"Adjustments to {item.label} overlap.")
            spans.setdefault(a.item_id, []).append((start, end))
            if a.action == "reduce_to":
                assert a.monthly is not None and perm.min_monthly is not None
                if a.monthly < perm.min_monthly:
                    raise ValueError(f"{item.label} cannot go below the lowest amount you allowed.")
                if a.monthly > item.monthly:
                    raise ValueError(f"A reduction cannot raise {item.label}.")
            elif a.to_month is not None:
                # A fixed pause is checked here. An open-ended one is counted month by month while evaluating.
                paused[a.item_id] = paused.get(a.item_id, 0) + (end - start + 1)
                assert perm.max_months is not None
                if paused[a.item_id] > perm.max_months:
                    raise ValueError(
                        f"{item.label} would be paused longer than the {perm.max_months} months you allowed."
                    )
        return self

    @property
    def end_month(self) -> str:
        return index_to_month(month_to_index(self.start_month) + self.months - 1)


class ItemMonth(ApiModel):
    item_id: Id
    amount: Amount
    adjusted: bool  # true when the amount is below the original this month


class RecoveryMonth(ApiModel):
    month: Month
    income: Amount
    mandatory_outflow: Amount
    flexible_outflow: Amount
    goal_transfers: Amount
    cash_change: Amount
    liquid_end: Amount
    mandatory_shortfall: Amount  # 0.00 unless cash could not cover the mandatory payments
    floor_met: bool
    net_worth_change: Amount  # cash change plus transfers into goal balances
    items: list[ItemMonth]


class RecoveryViolation(ApiModel):
    kind: Literal["mandatory_shortfall", "reserve_floor", "pause_limit"]
    month: Month
    amount: Amount  # how far short
    message: str


class RestorationStep(ApiModel):
    month: Month
    monthly: Amount


class RestorationOutcome(ApiModel):
    item_id: Id
    # not_triggered: the conditions were never all met. deferred: they were met but no step was affordable.
    # partial: some steps were applied but the original amount is not back. restored: the original amount is back.
    status: Literal["not_triggered", "deferred", "partial", "restored"]
    triggered_month: Month | None
    steps: list[RestorationStep]
    deferred_months: int
    final_monthly: Amount


class ReviewItem(ApiModel):
    item_id: Id
    status: Literal["not_triggered", "deferred", "partial", "restored"]


class ReviewSnapshot(ApiModel):
    """Where each restoration stood at the review month. The date itself restores nothing."""

    month: Month
    items: list[ReviewItem]


class RecoveryEvaluation(ApiModel):
    feasible: bool
    months: list[RecoveryMonth]
    violations: list[RecoveryViolation]
    first_violation_month: Month | None
    minimum_liquid: Amount
    final_liquid: Amount
    balances_end: dict[str, Amount]  # protected balances after the transfers credited to them
    protected_balances_withdrawn: Amount  # always 0.00: the evaluator never draws on them
    income_end_unknown: bool
    assumptions: list[str]
    restorations: list[RestorationOutcome] = Field(default_factory=list)
    review: ReviewSnapshot | None = None
