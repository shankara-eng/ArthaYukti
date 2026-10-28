"""Plan B: a month-by-month cash evaluator for a recovery plan, with explicit restoration.

It is deliberately separate from the goal projection (`engine/projection.py`), which allocates surplus to goals
by priority and, in a deficit, withdraws from goal balances. A recovery plan needs the opposite: contributions
are stated amounts, protected balances are never touched, and a shortfall is reported, never hidden.

Accounting convention (applied to every month, in order):
- liquid_end = liquid_start + income - mandatory - flexible - goal transfers.
- Mandatory = essentials, mandatory debt payments, protected obligations. They are paid first. If liquid_start +
  income cannot cover them, the amount missing is a `mandatory_shortfall` violation. The balance is allowed to go
  negative on the record: nothing is borrowed, sold or withdrawn to cover it.
- A goal contribution is a transfer from liquid cash into a protected balance. It lowers liquid cash but is not
  spending: `net_worth_change` = cash change + transfers.
- Unspent income simply stays in liquid cash. The research example's "additional reserve contribution" of 5,000 is
  that residual, not a separate outflow, so it is never counted twice.
- The reserve floor is checked on the liquid balance at the end of every month. Exactly at the floor passes.
- No returns, inflation, borrowing or asset sales are modelled. Protected balances only grow by credited transfers.

Restoration (an adjustment with no end month, "until restored"):
- Each month, before paying, the item's rule is tested. Every condition must hold: income this month at least X,
  liquid cash at the END of the previous month at least Y (the starting cash in the first month), the person's own
  confirmation (`recovery_confirmed_from`), and optionally a date. A date can never be the only condition.
- Once the rule is met the item steps back up: each step is due `step_gap_months` after the one before. With the
  affordability guard a step that would take liquid cash below the floor this month, or in any later month if nothing
  else changed, is deferred to a later month and retried; it is never applied silently. Without the guard it is applied and the breach is reported.
- A review month only reports where each restoration stands. It never restores anything.
- An open-ended pause counts month by month against its permitted maximum; going over is a `pause_limit` violation.
- Income is never assumed to recover: only the stated schedule is used, and a schedule with no end month is assumed
  to continue to the end of the modelled period (and said so in the assumptions).

Amounts are exact decimals (two places in, two places out); no rounding is needed or done.
"""

from dataclasses import dataclass, field
from decimal import Decimal

from app.engine.money import ZERO, engine_context, quantize
from app.schemas.recovery import (
    MANDATORY_KINDS,
    Adjustment,
    CashItem,
    ItemMonth,
    RecoveryEvaluation,
    RecoveryInput,
    RecoveryMonth,
    RecoveryViolation,
    RestorationOutcome,
    RestorationRule,
    RestorationStep,
    ReviewItem,
    ReviewSnapshot,
)
from app.timeline import index_to_month, month_to_index

ASSUMPTIONS = [
    "No investment returns, inflation, new borrowing, asset sales or missed payments are modelled.",
    "Money in protected balances is never withdrawn; it only grows by the contributions credited to it.",
    "Unspent income stays in liquid cash. Contributions to goals are transfers, not spending.",
    "The reserve floor is checked on the liquid balance at the end of every month.",
    "Income is taken only from the schedule you entered; it is never assumed to recover on its own.",
]


@dataclass
class _Restore:
    """Where one open-ended adjustment stands."""

    rule: RestorationRule
    original: Decimal
    triggered: int | None = None
    next_step: int = 0
    due: int = 0
    current: Decimal | None = None  # the amount once stepping has begun
    applied: list[tuple[int, Decimal]] = field(default_factory=list)
    deferred: int = 0
    paused_months: int = 0
    pause_limit_flagged: bool = False


def _static_amount(
    item: CashItem, index: int, first: int, last: int, adjustments: list[Adjustment]
) -> tuple[Decimal, bool]:
    start = month_to_index(item.from_month) if item.from_month else first
    end = month_to_index(item.to_month) if item.to_month else last
    if not start <= index <= end:
        return ZERO, False
    for a in adjustments:
        if a.to_month is None or a.item_id != item.id:
            continue
        if month_to_index(a.from_month) <= index <= month_to_index(a.to_month):
            if a.action == "pause":
                return ZERO, True
            assert a.monthly is not None
            return min(item.monthly, a.monthly), a.monthly < item.monthly
    return item.monthly, False


def scheduled_amount(item: CashItem, index: int, first: int, last: int) -> Decimal:
    """What the item pays in a month when nothing is adjusted (zero outside its own range)."""
    return _static_amount(item, index, first, last, [])[0]


def _totals(items: list[CashItem], amounts: dict[str, Decimal]) -> tuple[Decimal, Decimal, Decimal]:
    """Mandatory outflow, flexible outflow and goal transfers for the month."""
    mandatory = flexible = transfers = ZERO
    for item in items:
        amount = amounts[item.id]
        if item.kind in MANDATORY_KINDS:
            mandatory += amount
        elif item.kind == "flexible":
            flexible += amount
        else:
            transfers += amount
    return mandatory, flexible, transfers


def _adjusted_amount(item: CashItem, a: Adjustment) -> Decimal:
    if a.action == "pause":
        return ZERO
    assert a.monthly is not None
    return min(item.monthly, a.monthly)


def _status(state: _Restore, up_to: int | None = None) -> str:
    applied = [(i, v) for i, v in state.applied if up_to is None or i <= up_to]
    triggered = state.triggered is not None and (up_to is None or state.triggered <= up_to)
    if not triggered:
        return "not_triggered"
    if not applied:
        return "deferred"
    return "restored" if applied[-1][1] == state.original else "partial"


def evaluate_recovery(inp: RecoveryInput) -> RecoveryEvaluation:
    """Run the plan month by month. Pure and deterministic: the same input always gives the same result."""
    first = month_to_index(inp.start_month)
    last = first + inp.months - 1
    income_by_month: dict[int, Decimal] = {}
    unknown_end = False
    for segment in inp.income:
        start = month_to_index(segment.from_month)
        end = month_to_index(segment.to_month) if segment.to_month else last
        unknown_end = unknown_end or segment.to_month is None
        for m in range(start, end + 1):
            income_by_month[m] = segment.monthly_net

    items = {i.id: i for i in inp.items}
    rules = {r.item_id: r for r in inp.restorations}
    perms = {(p.item_id, p.action): p for p in inp.permissions}
    open_adj = {a.item_id: a for a in inp.adjustments if a.to_month is None}
    states = {iid: _Restore(rules[iid], items[iid].monthly) for iid in open_adj}
    confirmed = month_to_index(inp.recovery_confirmed_from) if inp.recovery_confirmed_from else None

    balances = {b.id: b.balance for b in inp.protected_balances}
    liquid = inp.liquid_cash
    rows: list[RecoveryMonth] = []
    violations: list[RecoveryViolation] = []
    lowest = liquid

    def conditions_hold(state: _Restore, index: int, liquid_before: Decimal) -> bool:
        for c in state.rule.conditions:
            if c.type == "income_at_least":
                assert c.amount is not None
                if income_by_month[index] < c.amount:
                    return False
            elif c.type == "liquid_at_least":
                assert c.amount is not None
                if liquid_before < c.amount:
                    return False
            elif c.type == "user_confirmed":
                if confirmed is None or index < confirmed:
                    return False
            elif c.type == "date_reached":
                assert c.month is not None
                if index < month_to_index(c.month):
                    return False
        return True

    def holds_through_horizon(index: int, liquid_end: Decimal, amounts: dict[str, Decimal]) -> bool:
        """Would the floor and the mandatory payments hold in every later month if nothing else changed?

        Items changed "until restored" are held at their current amounts; every other item follows its own
        schedule. This is the check behind the affordability guard, so a step back up is not taken in a month
        that is fine but leaves a later month short.
        """
        running = liquid_end
        for later in range(index + 1, last + 1):
            later_amounts: dict[str, Decimal] = {}
            for item in inp.items:
                if item.id in open_adj and later >= month_to_index(open_adj[item.id].from_month):
                    later_amounts[item.id] = amounts[item.id]
                else:
                    later_amounts[item.id] = _static_amount(
                        item, later, first, last, inp.adjustments
                    )[0]
            mandatory, flexible, transfers = _totals(inp.items, later_amounts)
            if running + income_by_month[later] - mandatory < ZERO:
                return False
            running = running + income_by_month[later] - mandatory - flexible - transfers
            if running < inp.reserve_floor:
                return False
        return True

    with engine_context():
        for index in range(first, last + 1):
            month = index_to_month(index)
            income = income_by_month[index]
            liquid_before = liquid

            # 1. The amount each item pays this month, before any step back up.
            amounts: dict[str, Decimal] = {}
            adjusted: dict[str, bool] = {}
            for item in inp.items:
                if item.id in open_adj and index >= month_to_index(open_adj[item.id].from_month):
                    state = states[item.id]
                    if state.triggered is None and conditions_hold(state, index, liquid_before):
                        state.triggered = index
                        state.due = index
                    if state.current is not None:
                        amounts[item.id] = state.current
                    else:
                        amounts[item.id] = _adjusted_amount(item, open_adj[item.id])
                else:
                    amounts[item.id], adjusted[item.id] = _static_amount(
                        item, index, first, last, inp.adjustments
                    )

            # 2. Steps back up that are due this month, each tested against the floor.
            for item in inp.items:
                state = states.get(item.id)
                if state is None or state.triggered is None:
                    continue
                steps = state.rule.steps or [item.monthly]
                if state.next_step >= len(steps) or index < state.due:
                    continue
                target = steps[state.next_step]
                now = amounts[item.id]
                if target <= now:
                    state.next_step += 1
                    state.due = index + state.rule.step_gap_months
                    continue
                mandatory, flexible, transfers = _totals(inp.items, amounts)
                end_if = liquid + income - mandatory - flexible - transfers - (target - now)
                if state.rule.affordability_guard and (
                    end_if < inp.reserve_floor
                    or not holds_through_horizon(index, end_if, {**amounts, item.id: target})
                ):
                    state.deferred += 1
                    continue
                amounts[item.id] = target
                state.current = target
                state.applied.append((index, target))
                state.next_step += 1
                state.due = index + state.rule.step_gap_months

            # 3. Pause limits for open-ended pauses.
            for iid, state in states.items():
                a = open_adj[iid]
                if (
                    a.action == "pause"
                    and index >= month_to_index(a.from_month)
                    and state.current is None
                ):
                    state.paused_months += 1
                    limit = perms[(iid, "pause")].max_months
                    assert limit is not None
                    if state.paused_months > limit and not state.pause_limit_flagged:
                        state.pause_limit_flagged = True
                        violations.append(
                            RecoveryViolation(
                                kind="pause_limit",
                                month=month,
                                amount=ZERO,
                                message=(
                                    f"{items[iid].label} would stay paused past the {limit} months you allowed "
                                    f"(by {month})."
                                ),
                            )
                        )

            # 4. Book the month.
            item_rows: list[ItemMonth] = []
            for item in inp.items:
                amount = amounts[item.id]
                in_range = (
                    _static_amount(item, index, first, last, [])[0] > ZERO or item.id in open_adj
                )
                item_rows.append(
                    ItemMonth(
                        item_id=item.id,
                        amount=amount,
                        adjusted=bool(in_range and amount < item.monthly),
                    )
                )
                if item.balance_id is not None:
                    balances[item.balance_id] += amount
            mandatory, flexible, transfers = _totals(inp.items, amounts)

            available = liquid + income - mandatory
            shortfall = quantize(-available) if available < ZERO else ZERO
            end_liquid = quantize(liquid + income - mandatory - flexible - transfers)
            floor_met = end_liquid >= inp.reserve_floor
            if shortfall > ZERO:
                violations.append(
                    RecoveryViolation(
                        kind="mandatory_shortfall",
                        month=month,
                        amount=shortfall,
                        message=f"In {month} cash cannot cover the mandatory payments; Rs {shortfall:,.2f} is missing.",
                    )
                )
            if not floor_met:
                gap = quantize(inp.reserve_floor - end_liquid)
                violations.append(
                    RecoveryViolation(
                        kind="reserve_floor",
                        month=month,
                        amount=gap,
                        message=(
                            f"At the end of {month} liquid cash is Rs {end_liquid:,.2f}, "
                            f"Rs {gap:,.2f} below your Rs {inp.reserve_floor:,.2f} floor."
                        ),
                    )
                )
            rows.append(
                RecoveryMonth(
                    month=month,
                    income=income,
                    mandatory_outflow=mandatory,
                    flexible_outflow=flexible,
                    goal_transfers=transfers,
                    cash_change=quantize(end_liquid - liquid),
                    liquid_end=end_liquid,
                    mandatory_shortfall=shortfall,
                    floor_met=floor_met,
                    net_worth_change=quantize(income - mandatory - flexible),
                    items=item_rows,
                )
            )
            liquid = end_liquid
            lowest = min(lowest, liquid)

    assumptions = list(ASSUMPTIONS)
    if unknown_end:
        assumptions.append(
            "The income reduction has no stated end, so it is assumed to continue to the end of the modelled period."
        )
    for iid, state in states.items():
        if state.rule.affordability_guard:
            assumptions.append(
                f"{items[iid].label} comes back only in a month where cash stays at or above the floor."
            )
    outcomes = [
        RestorationOutcome(
            item_id=iid,
            status=_status(state),  # type: ignore[arg-type]
            triggered_month=index_to_month(state.triggered)
            if state.triggered is not None
            else None,
            steps=[RestorationStep(month=index_to_month(i), monthly=v) for i, v in state.applied],
            deferred_months=state.deferred,
            final_monthly=state.applied[-1][1]
            if state.applied
            else _adjusted_amount(items[iid], open_adj[iid]),
        )
        for iid, state in states.items()
    ]
    review = None
    if inp.review_month is not None:
        at = month_to_index(inp.review_month)
        review = ReviewSnapshot(
            month=inp.review_month,
            items=[
                ReviewItem(item_id=iid, status=_status(state, at - 1))  # type: ignore[arg-type]
                for iid, state in states.items()
            ],
        )
    return RecoveryEvaluation(
        feasible=not violations,
        months=rows,
        violations=violations,
        first_violation_month=violations[0].month if violations else None,
        minimum_liquid=quantize(lowest),
        final_liquid=quantize(liquid),
        balances_end={k: quantize(v) for k, v in balances.items()},
        protected_balances_withdrawn=ZERO,
        income_end_unknown=unknown_end,
        assumptions=assumptions,
        restorations=outcomes,
        review=review,
    )
