"""Financial Trajectory: one monthly timeline for cash, assets, liabilities, insurance and selected goals.

Nothing here owns a record or asks for one again. The caller (api/trajectory.py) reads the person's records and hands
them over as plain inputs; this module only projects them. Rules (docs/FINANCIAL_TRAJECTORY.md):

- Every change to a balance is an event with a cash effect, an asset effect, a liability effect and a note. Balances
  move only through events, so cash, assets, liabilities and net worth reconcile by construction, and a transfer
  (cash to an investment, a goal contribution, a deposit maturing) nets to nothing.
- Income, spending and plan loan payments come from the same monthly flows the goal engine uses (`month_flows`), so the
  surplus here and the surplus there cannot disagree. Goal funding is the existing allocation policy
  (`project_resolved`); a contribution is a transfer of surplus into the goal's fund, never a second expense.
- A recorded debt is run on the existing amortization engine, so a loan's balance here equals the debt calculator's.
  The principal repaid reduces the liability; the interest is an expense. A payment of unknown split is an expense.
- Unknown stays unknown: a holding with no usable value is left out and reported, a debt with no payment keeps its
  balance and reports that its payoff is unknown. Nothing is silently zero.
- Future values of assets are held constant unless the person gave a return assumption for that holding or class.
  There is no default rate. Growth is applied at the end of a month to the balance the month opened with, at
  rate / 12, rounded to the paisa.
- Cash never goes below zero. What the recorded resources cannot pay is recorded as an unfunded shortfall (a liability
  line that only grows), month by month, so the impossible state is visible and net worth still reconciles.
- Monthly calendar, as in the goal engine. Order within a month: income and spending, growth, debt payments,
  insurance premiums and benefits, planned investment events, goal funding and goal effects, cash reconciliation.
"""

import copy
from dataclasses import dataclass, field
from decimal import Decimal
from functools import partial

from app.engine.debt import calculate_amortization_schedule
from app.engine.flows import month_flows
from app.engine.money import ZERO, engine_context, quantize
from app.engine.projection import project_resolved
from app.engine.setup import ExpenseShift, resolve
from app.schemas.plan import Plan
from app.schemas.scenario import Scenario
from app.timeline import index_to_month, month_to_index

MODEL_VERSION = "trajectory-1.0"

CLASSES = (
    "market_investments",
    "retirement_and_fixed_income",
    "deposits_and_investment_accounts",
    "physical_and_other_assets",
    "insurance_fund_value",
)
HOLDING_CLASS = {
    "stock": "market_investments",
    "mutual_fund": "market_investments",
    "crypto": "market_investments",
    "epf": "retirement_and_fixed_income",
    "ppf": "retirement_and_fixed_income",
    "gold": "physical_and_other_assets",
    "real_estate": "physical_and_other_assets",
    "other": "physical_and_other_assets",
}
GOAL_EFFECTS = ("spend", "asset_purchase", "debt_reduction", "hold")
DEFAULT_GOAL_EFFECT = {
    "home": "asset_purchase",
    "education": "spend",
    "loan_payoff": "hold",
    "retirement": "hold",
    "emergency_fund": "hold",
    "custom": "hold",
}


@dataclass(frozen=True)
class AccountIn:
    id: str
    name: str
    balance: Decimal
    account_type: str
    is_liquid: bool


@dataclass(frozen=True)
class HoldingIn:
    id: str
    name: str
    asset_type: str
    value: Decimal | None  # None: no usable value, so it is left out and reported
    basis: str  # market_snapshot | manual | none
    status: str  # fresh | stale | manual | unavailable | currency_mismatch
    as_of: str | None
    source: str | None
    message: str | None


@dataclass(frozen=True)
class LoanIn:
    id: str
    name: str
    category: str
    balance: Decimal
    rate: Decimal
    payment: Decimal
    remaining_months: int


@dataclass(frozen=True)
class PolicyIn:
    id: str
    name: str
    policy_type: str
    premium: Decimal
    frequency: str  # annual | monthly | quarterly
    status: str
    start_date: str
    renewal_date: str | None
    expiry_date: str | None
    fund_value: Decimal | None
    maturity_benefit: Decimal | None
    maturity_date: str | None


@dataclass(frozen=True)
class RateIn:
    scope: str  # holding | class
    key: str
    annual_rate: Decimal


@dataclass(frozen=True)
class GoalEffectIn:
    goal_id: str
    effect: str
    liability_id: str | None = None


@dataclass(frozen=True)
class PlannedEventIn:
    id: str
    month: str
    kind: str  # investment_purchase | deposit_maturity
    label: str
    amount: Decimal | None = None
    charges: Decimal = ZERO
    account_id: str | None = None
    maturity_amount: Decimal | None = None


@dataclass
class Inputs:
    plan: Plan
    horizon_months: int
    view: str  # baseline | selected_goals | scenario
    selected_goal_ids: list[str]
    scenario: Scenario | None
    opening_cash: Decimal
    cash_source: str
    accounts: list[AccountIn]  # the ones that are not spendable cash
    holdings: list[HoldingIn]
    loans: list[LoanIn]
    policies: list[PolicyIn]
    rates: list[RateIn] = field(default_factory=list)
    goal_effects: list[GoalEffectIn] = field(default_factory=list)
    planned_events: list[PlannedEventIn] = field(default_factory=list)
    premium_growth: Decimal = ZERO
    premiums_in_spending: bool = False
    linked_commitments: dict[str, str] = field(default_factory=dict)  # commitment id -> liability id
    reference_age: int | None = None
    notes: list[dict] = field(default_factory=list)  # warnings the caller found while reading the records
    spending_override: dict[int, Decimal] | None = None  # month t -> spending from the Expenditure plans
    inflation_annual: Decimal | None = None  # for the inflation-adjusted net worth only; it changes no cash flow


# ---------------------------------------------------------------------------------------------------------------------
# Events and balances


@dataclass
class _Ev:
    group: str  # income | expense | debt | insurance | investment | deposit | goal | other
    kind: str
    label: str
    source_id: str | None
    cash: Decimal = ZERO
    assets: list[tuple[str, str, Decimal]] = field(default_factory=list)
    liabilities: list[tuple[str, str, Decimal]] = field(default_factory=list)
    note: str = ""
    principal: Decimal | None = None
    interest: Decimal | None = None

    @property
    def asset_delta(self) -> Decimal:
        return sum((d for _, _, d in self.assets), ZERO)

    @property
    def liability_delta(self) -> Decimal:
        return sum((d for _, _, d in self.liabilities), ZERO)

    @property
    def net_worth_effect(self) -> Decimal:
        return self.cash + self.asset_delta - self.liability_delta


_BUCKETS = ("accounts", "holdings", "policy", "goal_funds", "goal_assets", "planned", "loans", "shortfall")


class _State:
    def __init__(self, cash: Decimal) -> None:
        self.cash = cash
        self.b: dict[str, dict[str, Decimal]] = {name: {} for name in _BUCKETS}

    def apply(self, ev: _Ev) -> None:
        self.cash = quantize(self.cash + ev.cash)
        for bucket, key, delta in ev.assets:
            self.b[bucket][key] = quantize(self.b[bucket].get(key, ZERO) + delta)
        for bucket, key, delta in ev.liabilities:
            self.b[bucket][key] = quantize(self.b[bucket].get(key, ZERO) + delta)


def _push(state: _State, events: list[_Ev], ev: _Ev) -> None:
    state.apply(ev)
    events.append(ev)


def _snapshot(state: _State, holding_class: dict[str, str]) -> dict[str, Decimal]:
    market = sum((v for k, v in state.b["holdings"].items() if holding_class.get(k) == "market_investments"), ZERO)
    market += sum(state.b["planned"].values(), ZERO)
    retirement = sum((v for k, v in state.b["holdings"].items() if holding_class.get(k) == "retirement_and_fixed_income"), ZERO)
    physical = sum((v for k, v in state.b["holdings"].items() if holding_class.get(k) == "physical_and_other_assets"), ZERO)
    physical += sum(state.b["goal_assets"].values(), ZERO)
    accounts = sum(state.b["accounts"].values(), ZERO)
    insurance = sum(state.b["policy"].values(), ZERO)
    goals = sum(state.b["goal_funds"].values(), ZERO)
    assets = state.cash + accounts + market + retirement + physical + insurance + goals
    loans = sum(state.b["loans"].values(), ZERO)
    shortfall = sum(state.b["shortfall"].values(), ZERO)
    liabilities = loans + shortfall
    return {
        "cash": quantize(state.cash),
        "deposits_and_investment_accounts": quantize(accounts),
        "market_investments": quantize(market),
        "retirement_and_fixed_income": quantize(retirement),
        "physical_and_other_assets": quantize(physical),
        "insurance_fund_value": quantize(insurance),
        "goal_funds": quantize(goals),
        "total_assets": quantize(assets),
        "loans": quantize(loans),
        "unfunded_shortfall": quantize(shortfall),
        "total_liabilities": quantize(liabilities),
        "net_worth": quantize(assets - liabilities),
    }


# ---------------------------------------------------------------------------------------------------------------------
# Loans: the existing amortization engine, in segments so a goal-funded prepayment can restart it


def loan_schedule(loan: LoanIn, horizon: int, prepay: dict[int, Decimal] | None = None) -> dict:
    """Month-by-month payments for one recorded debt, by month number t (1 = the plan's first month).

    Rows are exactly what `calculate_amortization_schedule` produces for the recorded balance, rate, payment and
    remaining months. A prepayment at month t is applied after that month's regular payment and the schedule restarts
    from the reduced balance with the same payment and the months that were left."""
    prepay = prepay or {}
    info: dict = {"status": "ok", "reason": None, "payoff_t": None, "paid_later_than_recorded": False}
    rows: dict[int, dict[str, Decimal]] = {}
    if loan.balance <= 0:
        return {"rows": rows, **info}
    if loan.payment <= 0:
        return {
            "rows": rows,
            **info,
            "status": "no_payment",
            "reason": "No payment is recorded for this debt, so its repayments and payoff date cannot be projected.",
        }
    recorded = loan.remaining_months if loan.remaining_months > 0 else 0
    balance = loan.balance
    done = 0  # months already scheduled
    while balance > 0 and done < horizon:
        tenure = (recorded - done) if recorded > 0 else 1200
        if tenure <= 0:
            tenure = 1  # the recorded months are used up: the next payment clears what is left
        try:
            result = calculate_amortization_schedule(
                principal=balance,
                annual_rate=loan.rate,
                tenure_months=min(tenure, 1200),
                monthly_emi=loan.payment,
            )
        except ValueError as error:
            return {"rows": rows, **info, "status": "unprojectable", "reason": str(error)}
        schedule = result["schedule"]
        stop = restart = False
        for item in schedule:
            t = done + int(item["month"])
            if t > horizon:
                stop = True
                break
            after = Decimal(str(item["remaining_balance"]))
            rows[t] = {
                "payment": Decimal(str(item["payment"])),
                "principal": Decimal(str(item["principal_paid"])),
                "interest": Decimal(str(item["interest_paid"])),
                "balance_after": after,
            }
            if after == 0:
                info["payoff_t"] = t
                balance = ZERO
                stop = True
                break
            if prepay.get(t, ZERO) > 0:
                paid = min(prepay[t], after)
                rows[t]["prepayment"] = paid
                balance = after - paid
                done = t
                restart = True
                if balance == 0:
                    info["payoff_t"] = t
                    stop = True
                break
        else:
            # The calculator stopped with a balance left (the payment is at or below the interest): carry on.
            if not schedule:
                break
            done += len(schedule)
            balance = Decimal(str(schedule[-1]["remaining_balance"]))
            continue
        if stop or not restart:
            break
    if rows and info["payoff_t"] is None:
        if loan.payment <= quantize(loan.balance * loan.rate / 12):
            info["status"] = "payment_below_interest"
            info["reason"] = "The recorded payment does not cover the monthly interest, so the balance does not fall."
        else:
            info["status"] = "not_cleared_in_horizon"
            info["reason"] = "The debt is not paid off within the months shown."
    if info["payoff_t"] is not None and recorded > 0 and info["payoff_t"] > recorded:
        info["paid_later_than_recorded"] = True
    return {"rows": rows, **info}


# ---------------------------------------------------------------------------------------------------------------------
# Insurance premium schedule


def _month_of(date: str) -> int:
    return int(date[5:7])


def premium_due(policy: PolicyIn, month_index: int) -> bool:
    """Whether a premium falls due in the calendar month `month_index` (year * 12 + month - 1)."""
    month = month_index % 12 + 1
    anchor = _month_of(policy.renewal_date or policy.start_date)
    if policy.frequency == "monthly":
        return True
    if policy.frequency == "quarterly":
        return (month - anchor) % 3 == 0
    return month == anchor


def policy_active_at(policy: PolicyIn, month_index: int) -> bool:
    if policy.status != "active":
        return False
    if policy.expiry_date and month_index > month_to_index(policy.expiry_date[:7]):
        return False
    return True


def contains_insurance_spending(plan: Plan) -> bool:
    """Whether a planned spending line looks like insurance premiums, so policy premiums are not counted twice."""
    for line in plan.expenses:
        text = f"{line.label} {line.category or ''}".lower()
        if line.id.startswith("premium_") or "insur" in text or "premium" in text:
            return True
    return False


# ---------------------------------------------------------------------------------------------------------------------
# The simulation


def _goal_effect(goal_type: str, goal_id: str, choices: dict[str, GoalEffectIn]) -> GoalEffectIn:
    chosen = choices.get(goal_id)
    if chosen is not None:
        return chosen
    return GoalEffectIn(goal_id, DEFAULT_GOAL_EFFECT.get(goal_type, "hold"))


def _rate(item_id: str, klass: str, rates: list[RateIn]) -> Decimal | None:
    by_item = [r for r in rates if r.scope == "holding" and r.key == item_id]
    if by_item:
        return by_item[-1].annual_rate
    by_class = [r for r in rates if r.scope == "class" and r.key == klass]
    return by_class[-1].annual_rate if by_class else None


def _simulate(inp: Inputs, view: str, prepay: dict[str, dict[int, Decimal]]) -> dict:
    plan = inp.plan
    horizon = inp.horizon_months
    as_of_index = month_to_index(plan.as_of)

    def label(t: int) -> str:
        return index_to_month(as_of_index + t - 1)


    selected = view != "baseline"
    chosen_goals = [g for g in plan.goals if g.id in set(inp.selected_goal_ids)] if selected else []
    commitments = [c for c in plan.commitments if c.id not in inp.linked_commitments]
    plan_flows = plan.model_copy(update={"goals": chosen_goals, "commitments": commitments})
    scenario = inp.scenario if view == "scenario" else None
    base = resolve(plan_flows, scenario)
    if inp.spending_override is not None:
        base.spending_override = inp.spending_override
    flows = [month_flows(base, t) for t in range(1, horizon + 1)]

    schedules = {loan.id: loan_schedule(loan, horizon, prepay.get(loan.id)) for loan in inp.loans}
    loan_class = schedules

    # Cash that moves outside the plan's own flows (positive: leaves the household). The goal engine needs this too.
    outside = [ZERO] * (horizon + 1)
    premium_amounts: dict[tuple[str, int], Decimal] = {}
    for loan in inp.loans:
        for t, row in loan_class[loan.id]["rows"].items():
            outside[t] += row["payment"]
    for policy in inp.policies:
        for t in range(1, horizon + 1):
            index = as_of_index + t - 1
            if policy.premium > 0 and policy_active_at(policy, index) and premium_due(policy, index):
                amount = quantize(policy.premium * (1 + inp.premium_growth) ** ((t - 1) // 12))
                premium_amounts[(policy.id, t)] = amount
                if not inp.premiums_in_spending:
                    outside[t] += amount
            if policy.maturity_benefit and policy.maturity_date and policy.status == "active":
                if month_to_index(policy.maturity_date[:7]) == index:
                    outside[t] -= policy.maturity_benefit
    holding_class = {h.id: HOLDING_CLASS.get(h.asset_type, "physical_and_other_assets") for h in inp.holdings}
    deposit_accounts = {a.id: a for a in inp.accounts}
    for event in inp.planned_events:
        t = month_to_index(event.month) - as_of_index + 1
        if not 1 <= t <= horizon:
            continue
        if event.kind == "investment_purchase":
            outside[t] += (event.amount or ZERO) + event.charges
        elif event.kind == "deposit_maturity":
            account = deposit_accounts[event.account_id or ""]
            outside[t] -= event.maturity_amount if event.maturity_amount is not None else account.balance

    state = _State(inp.opening_cash)
    for account in inp.accounts:
        state.b["accounts"][account.id] = account.balance
    for holding in inp.holdings:
        if holding.value is not None:
            state.b["holdings"][holding.id] = holding.value
    for policy in inp.policies:
        if policy.fund_value is not None and policy.status == "active":
            state.b["policy"][policy.id] = policy.fund_value
    for goal in plan.goals:
        state.b["goal_funds"][goal.id] = goal.current_savings
    for loan in inp.loans:
        if loan.balance > 0:
            state.b["loans"][loan.id] = loan.balance
    opening = _snapshot(state, holding_class)

    engine_rows = None
    outcomes: dict = {}
    goal_meta: dict[str, dict] = {}
    if chosen_goals:
        resolved = copy.copy(base)
        resolved.expense_shifts = list(base.expense_shifts) + [
            ExpenseShift(t, t, outside[t]) for t in range(1, horizon + 1) if outside[t] != 0
        ]
        resolved.unassigned = inp.opening_cash
        resolved.horizon = min(600, max(base.horizon, horizon))  # the engine needs room up to its latest goal date
        projection = project_resolved(resolved, True)
        engine_rows = projection.monthly[:horizon]
        outcomes = {o.goal_id: o for o in projection.goals}
        deadlines = {spec.id: spec.deadline for spec in resolved.goals}
        choices = {e.goal_id: e for e in inp.goal_effects}
        for goal in chosen_goals:
            first_realised = next(
                (t for t, row in enumerate(engine_rows, start=1) if any(g.goal_id == goal.id and g.realised for g in row.goals)),
                None,
            )
            effect = _goal_effect(goal.type, goal.id, choices)
            when = None if first_realised is None else max(deadlines[goal.id], first_realised)
            if goal.type == "emergency_fund":
                effect = GoalEffectIn(goal.id, "hold")
            goal_meta[goal.id] = {"effect": effect, "t": when, "deadline": deadlines[goal.id]}

    rows: list[dict] = []
    adjust: dict[str, Decimal] = {g.id: ZERO for g in chosen_goals}  # goal fund already spent or converted
    drivers = {
        "income": ZERO,
        "spending": ZERO,
        "interest_paid": ZERO,
        "principal_repaid": ZERO,
        "premiums_paid": ZERO,
        "benefits_received": ZERO,
        "goal_spending": ZERO,
        "market_growth": ZERO,
        "goal_growth": ZERO,
        "investment_charges": ZERO,
        "shortfall": ZERO,
    }
    reconciles = True
    needed_prepay: dict[str, dict[int, Decimal]] = {}
    loan_by_id = {loan.id: loan for loan in inp.loans}
    warnings_dynamic: list[dict] = []

    for t in range(1, horizon + 1):
        f = flows[t - 1]
        month = label(t)
        index = as_of_index + t - 1
        before = _snapshot(state, holding_class)
        events: list[_Ev] = []

        push = partial(_push, state, events)

        # 1. Income, spending, plan loan payments, one-time items (the same flows the goal engine uses)
        if f.income:
            push(_Ev("income", "income", "Planned income", "income", cash=f.income, note="From the Income module, after each stream's own raises and step-ups."))
            drivers["income"] += f.income
        if base.extra_monthly:
            push(_Ev("income", "scenario_extra_savings", "Extra monthly savings (scenario)", None, cash=base.extra_monthly, note="A scenario assumption, not a recorded income."))
        if f.expenses:
            push(_Ev("expense", "spending", "Planned spending", "expenditure", cash=-f.expenses, note="From the Expenditure module, including any scenario change."))
            drivers["spending"] += f.expenses
        if f.commitments:
            push(
                _Ev(
                    "expense",
                    "plan_loan_payment",
                    "Loan payments in the plan",
                    "plan",
                    cash=-f.commitments,
                    note="The split between principal and interest is not recorded, so the whole payment is counted as spending.",
                )
            )
            drivers["spending"] += f.commitments
        if f.one_offs > 0:
            push(_Ev("income", "one_time_income", "One-time income (scenario)", None, cash=f.one_offs))
            drivers["income"] += f.one_offs
        elif f.one_offs < 0:
            push(_Ev("expense", "one_time_expense", "One-time expense (scenario)", None, cash=f.one_offs))
            drivers["spending"] += -f.one_offs

        # 2. Growth on the balances the month opened with, only where the person gave a return assumption
        def grow(bucket: str, key: str, name: str, klass: str, source: str, push=push) -> None:  # noqa: B008
            rate = _rate(key, klass, inp.rates)
            value = state.b[bucket].get(key, ZERO)
            if rate is None or value <= 0:
                return
            delta = quantize(value * rate / 12)
            if delta == 0:
                return
            push(
                _Ev(
                    "investment",
                    "assumed_growth",
                    f"Assumed growth: {name}",
                    source,
                    assets=[(bucket, key, delta)],
                    note=f"Your assumption of {rate * 100:.2f}% a year, applied at month end to the opening value. Not a guarantee.",
                )
            )
            drivers["market_growth"] += delta

        for holding in inp.holdings:
            if holding.id in state.b["holdings"]:
                grow("holdings", holding.id, holding.name, holding_class[holding.id], holding.id)
        for account in inp.accounts:
            grow("accounts", account.id, account.name, "deposits_and_investment_accounts", account.id)
        for policy in inp.policies:
            if policy.id in state.b["policy"]:
                grow("policy", policy.id, policy.name, "insurance_fund_value", policy.id)
        for event in inp.planned_events:
            if event.kind == "investment_purchase" and event.id in state.b["planned"]:
                grow("planned", event.id, event.label, "market_investments", event.id)
        for goal_id in sorted(state.b["goal_assets"]):
            grow("goal_assets", goal_id, "Property from a goal", "physical_and_other_assets", goal_id)

        # 3. Debt: principal reduces the liability together with cash; interest is an expense
        for loan in inp.loans:
            row = loan_class[loan.id]["rows"].get(t)
            if row is None:
                continue
            push(
                _Ev(
                    "debt",
                    "loan_payment",
                    f"Payment: {loan.name}",
                    loan.id,
                    cash=-row["payment"],
                    liabilities=[("loans", loan.id, -row["principal"])],
                    principal=row["principal"],
                    interest=row["interest"],
                    note="Interest is an expense. Principal reduces the debt and is not an expense.",
                )
            )
            drivers["interest_paid"] += row["interest"]
            drivers["principal_repaid"] += row["principal"]

        # 4. Insurance premiums and documented benefits
        for policy in inp.policies:
            amount = premium_amounts.get((policy.id, t))
            if amount is not None:
                if inp.premiums_in_spending:
                    push(
                        _Ev(
                            "insurance",
                            "premium_in_spending",
                            f"Premium: {policy.name}",
                            policy.id,
                            note=f"A premium of {amount} falls due. It is already counted in your planned spending, so it is not taken again here.",
                        )
                    )
                else:
                    push(
                        _Ev(
                            "insurance",
                            "premium",
                            f"Premium: {policy.name}",
                            policy.id,
                            cash=-amount,
                            note="An expense. Cover (sum assured) is not an asset.",
                        )
                    )
                    drivers["premiums_paid"] += amount
            if policy.maturity_benefit and policy.maturity_date and policy.status == "active":
                if month_to_index(policy.maturity_date[:7]) == index:
                    push(
                        _Ev(
                            "insurance",
                            "maturity_benefit",
                            f"Documented benefit: {policy.name}",
                            policy.id,
                            cash=policy.maturity_benefit,
                            note="The benefit you recorded, received once in this month. No further growth is applied to it.",
                        )
                    )
                    drivers["benefits_received"] += policy.maturity_benefit

        # 5. Planned investment events
        for event in inp.planned_events:
            when = month_to_index(event.month) - as_of_index + 1
            if when != t:
                continue
            if event.kind == "investment_purchase":
                amount = event.amount or ZERO
                push(
                    _Ev(
                        "investment",
                        "investment_purchase",
                        event.label,
                        event.id,
                        cash=-(amount + event.charges),
                        assets=[("planned", event.id, amount)],
                        note="A transfer from cash to an investment: not an expense. Charges are expenses.",
                    )
                )
                drivers["investment_charges"] += event.charges
            else:
                account = deposit_accounts[event.account_id or ""]
                held = state.b["accounts"].get(account.id, ZERO)
                received = event.maturity_amount if event.maturity_amount is not None else held
                push(
                    _Ev(
                        "deposit",
                        "deposit_maturity",
                        event.label,
                        account.id,
                        cash=received,
                        assets=[("accounts", account.id, -held)],
                        note="The principal moves from the deposit to cash. Only the amount above the recorded balance is income.",
                    )
                )

        # 6. Goals (the allocation policy) or, with no goals, the cash reconciliation
        uncovered = ZERO
        if engine_rows is not None:
            row = engine_rows[t - 1]
            if label(t) != row.month:
                raise RuntimeError("the goal engine and the trajectory disagree about the month")
            goal_names = {g.id: g.label for g in chosen_goals}
            for g in row.goals:
                name = goal_names[g.goal_id]
                if g.growth:
                    push(_Ev("goal", "goal_growth", f"Growth: {name}", g.goal_id, assets=[("goal_funds", g.goal_id, g.growth)], note="At the plan's savings return, on the goal's own balance."))
                    drivers["goal_growth"] += g.growth
                if g.contribution:
                    push(_Ev("goal", "goal_contribution", f"Saved toward: {name}", g.goal_id, cash=-g.contribution, assets=[("goal_funds", g.goal_id, g.contribution)], note="A transfer of surplus into the goal. It is not an expense."))
                if g.withdrawal:
                    push(_Ev("goal", "goal_withdrawal", f"Drawn from: {name}", g.goal_id, cash=g.withdrawal, assets=[("goal_funds", g.goal_id, -g.withdrawal)], note="Taken back to cover a month the surplus could not."))
            for g in row.goals:
                expected = quantize(g.balance - adjust[g.goal_id])
                gap = quantize(expected - state.b["goal_funds"].get(g.goal_id, ZERO))
                if gap != 0:
                    name = goal_names[g.goal_id]
                    push(
                        _Ev(
                            "goal",
                            "goal_allocation",
                            f"{'Cash assigned to' if gap > 0 else 'Released above target from'}: {name}",
                            g.goal_id,
                            cash=-gap,
                            assets=[("goal_funds", g.goal_id, gap)],
                            note="A transfer between cash and the goal's fund.",
                        )
                    )
            uncovered = row.uncovered_deficit
        else:
            if state.cash < 0:
                uncovered = -state.cash
        if uncovered > 0:
            push(
                _Ev(
                    "other",
                    "unfunded_shortfall",
                    "Shortfall the recorded cash cannot cover",
                    None,
                    cash=uncovered,
                    liabilities=[("shortfall", "total", uncovered)],
                    note="Recorded cash and available goal funds ran out. This is shown as an unfunded shortfall, never hidden.",
                )
            )
            drivers["shortfall"] += uncovered

        # 7. Goal effects at the goal's date (or when it is funded, if later)
        for goal in chosen_goals:
            meta = goal_meta.get(goal.id)
            if meta is None or meta["t"] != t:
                continue
            effect: GoalEffectIn = meta["effect"]
            held = state.b["goal_funds"].get(goal.id, ZERO)
            if held <= 0 or effect.effect == "hold":
                continue
            if effect.effect == "spend":
                push(
                    _Ev(
                        "goal",
                        "goal_spending",
                        f"Spent: {goal.label}",
                        goal.id,
                        assets=[("goal_funds", goal.id, -held)],
                        note="A spending goal: the funded amount is spent and has no matching asset. It reduces net worth.",
                    )
                )
                adjust[goal.id] += held
                drivers["goal_spending"] += held
            elif effect.effect == "asset_purchase":
                push(
                    _Ev(
                        "goal",
                        "goal_asset_purchase",
                        f"Bought with the goal fund: {goal.label}",
                        goal.id,
                        assets=[("goal_funds", goal.id, -held), ("goal_assets", goal.id, held)],
                        note="Cash becomes an asset. The purchase price, financing and any future value are not recorded: the asset is held at the amount spent.",
                    )
                )
                adjust[goal.id] += held
            elif effect.effect == "debt_reduction" and effect.liability_id in loan_by_id:
                loan_rows = loan_class[effect.liability_id]["rows"]
                paid = loan_rows.get(t, {}).get("prepayment", ZERO)
                applied = min(held, state.b["loans"].get(effect.liability_id, ZERO))
                needed_prepay.setdefault(effect.liability_id, {})[t] = applied
                if paid > 0 and applied > 0:
                    push(
                        _Ev(
                            "goal",
                            "goal_debt_reduction",
                            f"Paid toward {loan_by_id[effect.liability_id].name}: {goal.label}",
                            goal.id,
                            assets=[("goal_funds", goal.id, -applied)],
                            liabilities=[("loans", effect.liability_id, -applied)],
                            note="The goal fund reduces the debt's principal. Later payments follow the reduced balance.",
                        )
                    )
                    adjust[goal.id] += applied

        closing = _snapshot(state, holding_class)
        effect_sum = sum((e.net_worth_effect for e in events), ZERO)
        if quantize(closing["net_worth"] - before["net_worth"]) != quantize(effect_sum):
            reconciles = False
        if engine_rows is not None and state.cash != engine_rows[t - 1].free_cash:
            # A debt prepayment never moves cash, so cash must equal the goal engine's free cash.
            reconciles = False
        grouped: dict[str, list[dict]] = {name: [] for name in ("income", "expense", "debt", "insurance", "investment", "deposit", "goal", "other")}
        for ev in events:
            grouped[ev.group].append(
                {
                    "month": month,
                    "kind": ev.kind,
                    "label": ev.label,
                    "source_id": ev.source_id,
                    "cash_delta": ev.cash,
                    "asset_delta": ev.asset_delta,
                    "liability_delta": ev.liability_delta,
                    "net_worth_effect": ev.net_worth_effect,
                    "principal": ev.principal,
                    "interest": ev.interest,
                    "note": ev.note,
                }
            )
        rows.append(
            {
                "month": month,
                "opening_balances": before,
                "income_events": grouped["income"],
                "expense_events": grouped["expense"],
                "debt_events": grouped["debt"],
                "insurance_events": grouped["insurance"],
                "investment_events": grouped["investment"],
                "deposit_events": grouped["deposit"],
                "goal_events": grouped["goal"],
                "other_events": grouped["other"],
                "closing_balances": closing,
                "net_worth": closing["net_worth"],
                "uncovered_cash_deficit": uncovered,
            }
        )

    return {
        "rows": rows,
        "opening": opening,
        "schedules": schedules,
        "reconciles": reconciles,
        "drivers": drivers,
        "goal_meta": goal_meta,
        "outcomes": outcomes,
        "needed_prepay": needed_prepay,
        "warnings": warnings_dynamic,
        "holding_class": holding_class,
    }


# ---------------------------------------------------------------------------------------------------------------------
# Diagnostics: what is missing, what was assumed, where each value came from


def _warn(code: str, severity: str, message: str, component: str, record_id: str | None = None, route: str | None = None, related_id: str | None = None) -> dict:
    return {"code": code, "severity": severity, "message": message, "component": component, "record_id": record_id, "edit_route": route, "related_id": related_id}


def _diagnostics(inp: Inputs, sim: dict) -> dict:
    plan = inp.plan
    warnings: list[dict] = list(inp.notes)
    missing: list[dict] = []
    provenance: list[dict] = []
    assumptions: list[dict] = []

    def need(record: str, record_id: str | None, field_name: str, reason: str, route: str) -> None:
        missing.append({"record": record, "record_id": record_id, "field": field_name, "reason": reason, "edit_route": route})

    recorded = bool(inp.accounts) or bool(inp.holdings) or bool(inp.loans) or any(g.current_savings > 0 for g in plan.goals) or inp.opening_cash > 0
    provenance.append({"component": "cash", "label": "Spendable cash", "kind": "user_entered", "source": inp.cash_source, "detail": None, "as_of": None})
    for account in inp.accounts:
        provenance.append({"component": "accounts", "label": account.name, "kind": "user_entered", "source": "Account balance you entered", "detail": account.account_type, "as_of": None})
        if account.account_type in ("fixed_deposit", "brokerage"):
            warnings.append(_warn("deposit_terms_not_recorded", "info", f"{account.name}: rate, maturity date and payout option are not recorded, so it is held at its recorded balance.", "deposits", account.id, "equities"))
    for holding in inp.holdings:
        if holding.value is None:
            warnings.append(_warn("value_unknown", "warning", f"{holding.name}: {holding.message or 'no value is available'} It is left out of the projection, not counted as zero.", "equities", holding.id, "equities"))
            need("holding", holding.id, "current_value", "No stored price and no value entered.", "equities")
            continue
        kind = "provider_fetched" if holding.basis == "market_snapshot" else "user_entered"
        provenance.append({"component": "holdings", "label": holding.name, "kind": kind, "source": holding.source, "detail": holding.message, "as_of": holding.as_of})
        if holding.status == "stale":
            warnings.append(_warn("stale_quote", "warning", f"{holding.name}: valued at the last stored price ({holding.as_of or 'date unknown'}, {holding.source or 'source unknown'}), which is old.", "equities", holding.id, "equities"))
    for loan in inp.loans:
        provenance.append({"component": "loans", "label": loan.name, "kind": "user_entered", "source": "Debt record", "detail": f"{loan.category}", "as_of": None})
        schedule = sim["schedules"][loan.id]
        if loan.rate == 0 and loan.payment > 0:
            warnings.append(_warn("loan_rate_zero", "warning", f"{loan.name}: the recorded interest rate is 0%. If the rate was never entered, its interest is understated and it clears sooner than it will.", "debts", loan.id, "debts"))
            need("debt", loan.id, "interest_rate", "A rate of 0% cannot be told apart from a rate that was not entered.", "debts")
        if schedule["status"] == "no_payment":
            warnings.append(_warn("loan_payment_missing", "warning", f"{loan.name}: the balance is recorded but no payment is, so its principal and interest cannot be projected and its payoff date is unknown.", "debts", loan.id, "debts"))
            need("debt", loan.id, "monthly_emi", schedule["reason"], "debts")
        elif schedule["status"] == "payment_below_interest":
            warnings.append(_warn("loan_payment_below_interest", "warning", f"{loan.name}: the recorded payment is below the monthly interest, so the balance grows.", "debts", loan.id, "debts"))
        elif schedule["status"] == "unprojectable":
            warnings.append(_warn("loan_unprojectable", "warning", f"{loan.name}: {schedule['reason']}", "debts", loan.id, "debts"))
        elif schedule["status"] == "not_cleared_in_horizon":
            warnings.append(_warn("loan_not_cleared", "info", f"{loan.name}: still owed at the end of the period shown.", "debts", loan.id, "debts"))
        if schedule["paid_later_than_recorded"]:
            warnings.append(_warn("loan_term_mismatch", "info", f"{loan.name}: at the recorded payment it clears later than the {loan.remaining_months} months recorded. Check the payment, rate and months.", "debts", loan.id, "debts"))
    for policy in inp.policies:
        provenance.append({"component": "policies", "label": policy.name, "kind": "user_entered", "source": "Insurance record", "detail": policy.policy_type, "as_of": None})
        if policy.policy_type == "ulip" and policy.fund_value is None:
            warnings.append(_warn("ulip_fund_unknown", "warning", f"{policy.name}: the current fund value is not recorded, so no asset is counted for it. The sum assured is cover, not an asset.", "insurance", policy.id, "insurance"))
            need("policy", policy.id, "fund_value", "A ULIP's current fund value is needed to count it once as an asset.", "insurance")
        if policy.policy_type == "endowment_money_back" and policy.maturity_benefit is None and policy.status == "active":
            warnings.append(_warn("benefit_unknown", "info", f"{policy.name}: no documented maturity or survival benefit is recorded, so none is projected.", "insurance", policy.id, "insurance"))
        if policy.status == "active" and policy.premium > 0 and not policy.expiry_date:
            warnings.append(_warn("premium_end_unknown", "info", f"{policy.name}: no expiry or final premium date is recorded, so premiums are assumed to continue.", "insurance", policy.id, "insurance"))
        if policy.status == "active" and policy.renewal_date and policy.renewal_date[:7] < plan.as_of:
            warnings.append(_warn("renewal_in_past", "info", f"{policy.name}: the recorded renewal date has passed. Its schedule is assumed to continue on the same month.", "insurance", policy.id, "insurance"))
    if inp.policies and any(p.status == "active" and p.premium > 0 for p in inp.policies):
        warnings.append(_warn("renewal_price_unknown", "info", "Renewal premiums are held at today's amount" + (f", changed by {inp.premium_growth * 100:.2f}% a year as you set." if inp.premium_growth else ". Real renewal prices are not known."), "insurance", None, "insurance"))
    plan_loans = [c for c in plan.commitments if c.id not in inp.linked_commitments]
    if plan_loans:
        total = sum((c.monthly_payment for c in plan_loans), ZERO)
        warnings.append(_warn("plan_loans_unsplit", "info", f"Loan payments in the plan ({total} a month) are counted as spending. Their principal, interest and balance are not recorded, so no debt trajectory exists for them.", "debts", None, "finances"))
    for commitment in plan_loans:
        for loan in inp.loans:
            if loan.payment > 0 and loan.payment == commitment.monthly_payment:
                warnings.append(_warn("possible_duplicate_debt", "warning", f"'{commitment.label}' in the plan and '{loan.name}' in your debts have the same payment ({loan.payment}). If they are one loan it is counted twice: link them.", "debts", loan.id, "debts", commitment.id))
    if inp.opening_cash == 0 and not inp.accounts and not inp.holdings:
        warnings.append(_warn("no_cash_recorded", "warning", "No account balance is recorded, so the projection starts from no cash.", "cash", None, "equities"))
        need("account", None, "balance", "Record at least one account balance to start the projection from your real position.", "equities")
    shortfall_months = [r["month"] for r in sim["rows"] if r["uncovered_cash_deficit"] > 0]
    if shortfall_months:
        warnings.append(_warn("cash_shortfall", "critical", f"Recorded cash and goal funds cannot cover spending in {len(shortfall_months)} month(s), starting {shortfall_months[0]}. The gap is shown as an unfunded shortfall.", "cash", None, None))
    for goal_id, meta in sim["goal_meta"].items():
        goal = next(g for g in plan.goals if g.id == goal_id)
        if meta["t"] is None:
            warnings.append(_warn("goal_not_funded", "warning", f"{goal.label}: not fully funded within the period shown, so its effect on net worth is not applied.", "goals", goal_id, "goals"))
        elif meta["t"] > inp.horizon_months:
            warnings.append(_warn("goal_after_horizon", "info", f"{goal.label}: falls after the period shown.", "goals", goal_id, "goals"))
        if goal.type == "custom" and not any(e.goal_id == goal_id for e in inp.goal_effects):
            warnings.append(_warn("goal_effect_unchosen", "info", f"{goal.label}: a custom goal's effect is not inferred from its name. Its fund is held aside until you choose one.", "goals", goal_id, "goals"))
        if goal.type == "loan_payoff" and meta["effect"].effect == "hold":
            warnings.append(_warn("goal_effect_unchosen", "info", f"{goal.label}: no debt is linked, so its fund is held aside and no debt is reduced.", "goals", goal_id, "goals"))
    if not sim["reconciles"]:
        warnings.append(_warn("ledger_mismatch", "critical", "The monthly ledger did not reconcile. Do not rely on this projection.", "ledger", None, None))

    constant = [c for c in CLASSES if _class_present(inp, c) and not any(r.scope == "class" and r.key == c for r in inp.rates)]
    for klass in constant:
        assumptions.append({"id": f"return.{klass}", "label": f"Future value of {klass.replace('_', ' ')}", "value": "Held at the recorded value (no return assumption set)", "kind": "default_rule", "source": "Rule: no growth is assumed without your input", "edit_route": None})
    for rate in inp.rates:
        assumptions.append({"id": f"return.{rate.scope}.{rate.key}", "label": f"Assumed return: {rate.key}", "value": f"{rate.annual_rate * 100:.2f}% a year, monthly timing", "kind": "user_assumed", "source": "Set by you for this projection", "edit_route": None})
    assumptions += [
        {"id": "income.growth", "label": "Income growth, raises and step-ups", "value": "As set on each income", "kind": "plan", "source": "Income module", "edit_route": "finances"},
        {"id": "expense.growth", "label": "Spending growth", "value": f"{plan.assumptions.expense_growth_annual * 100:.2f}% a year unless a line has its own", "kind": "plan", "source": "Expenditure module", "edit_route": "finances"},
        {"id": "goal.return", "label": "Return on goal funds", "value": f"{plan.assumptions.savings_return_annual * 100:.2f}% a year, goal funds only", "kind": "plan", "source": "Plan assumptions", "edit_route": None},
        {"id": "cash.return", "label": "Return on spendable cash", "value": "None", "kind": "default_rule", "source": "Rule: cash earns nothing here", "edit_route": None},
        {"id": "loan.rate", "label": "Loan interest rates", "value": "Held at each recorded rate", "kind": "default_rule", "source": "Debt records (resets are not modelled)", "edit_route": "debts"},
        {"id": "premium.in_spending", "label": "Insurance premiums", "value": "Already in planned spending, so not added again" if inp.premiums_in_spending else "Added from each policy's schedule", "kind": "default_rule", "source": "Counted once", "edit_route": "insurance"},
        {"id": "timing", "label": "Timing", "value": "Monthly. Growth at month end on the opening balance, at rate / 12.", "kind": "default_rule", "source": f"Model {MODEL_VERSION}", "edit_route": None},
    ]
    if not recorded:
        status = "insufficient"
    elif missing or any(w["severity"] in ("warning", "critical") for w in warnings):
        status = "partial"
    else:
        status = "complete"
    stale = [w for w in warnings if w["code"] == "stale_quote"]
    return {
        "warnings": warnings,
        "completeness": {"status": status, "missing": missing, "recorded": recorded, "stale_quotes": len(stale)},
        "provenance": provenance,
        "assumptions": assumptions,
    }


def _class_present(inp: Inputs, klass: str) -> bool:
    if klass == "deposits_and_investment_accounts":
        return bool(inp.accounts)
    if klass == "insurance_fund_value":
        return any(p.fund_value is not None for p in inp.policies)
    return any(HOLDING_CLASS.get(h.asset_type, "physical_and_other_assets") == klass for h in inp.holdings if h.value is not None)


_GROUP_KEYS = (
    ("income", "income_events"),
    ("expense", "expense_events"),
    ("debt", "debt_events"),
    ("insurance", "insurance_events"),
    ("investment", "investment_events"),
    ("deposit", "deposit_events"),
    ("goal", "goal_events"),
    ("other", "other_events"),
)


def _yearly(rows: list[dict], age, real) -> list[dict]:
    """Calendar-year rows from the monthly ledger: opening and closing balances, cash in and out by group, and the
    interest and principal of debt payments. Nothing is calculated that the months do not already say."""
    out: list[dict] = []
    start = 0
    while start < len(rows):
        year = rows[start]["month"][:4]
        end = start
        while end < len(rows) and rows[end]["month"][:4] == year:
            end += 1
        chunk = rows[start:end]
        opening, closing = chunk[0]["opening_balances"], chunk[-1]["closing_balances"]
        groups = {name: [ZERO, ZERO, ZERO] for name, _ in _GROUP_KEYS}
        interest = principal = effects = ZERO
        for row in chunk:
            for name, key in _GROUP_KEYS:
                for event in row[key]:
                    cash = event["cash_delta"]
                    groups[name][0 if cash > 0 else 1] += cash if cash > 0 else -cash
                    groups[name][2] += event["net_worth_effect"]
                    effects += event["net_worth_effect"]
                    if name == "debt":
                        interest += event["interest"] or ZERO
                        principal += event["principal"] or ZERO
        change = closing["net_worth"] - opening["net_worth"]
        out.append(
            {
                "year": int(year),
                "months_included": len(chunk),
                "age": age(end),
                "opening_cash": opening["cash"],
                "closing_cash": closing["cash"],
                "cash_in": quantize(sum((g[0] for g in groups.values()), ZERO)),
                "cash_out": quantize(sum((g[1] for g in groups.values()), ZERO)),
                "interest_paid": quantize(interest),
                "principal_repaid": quantize(principal),
                "groups": [{"group": n, "cash_in": quantize(v[0]), "cash_out": quantize(v[1]), "net_worth_effect": quantize(v[2])} for n, v in groups.items()],
                "closing_market_investments": closing["market_investments"],
                "closing_deposits_and_accounts": closing["deposits_and_investment_accounts"],
                "closing_retirement_and_fixed_income": closing["retirement_and_fixed_income"],
                "closing_physical_and_other_assets": closing["physical_and_other_assets"],
                "closing_total_assets": closing["total_assets"],
                "closing_total_liabilities": closing["total_liabilities"],
                "opening_net_worth": opening["net_worth"],
                "closing_net_worth": closing["net_worth"],
                "net_worth_change": quantize(change),
                "closing_net_worth_real": real(closing["net_worth"], end),
                "reconciles": quantize(change) == quantize(effects),
            }
        )
        start = end
    return out


def run_trajectory(inp: Inputs) -> dict:
    """The whole result as plain data. Money is Decimal; the API turns it into decimal strings."""
    with engine_context():
        prepay: dict[str, dict[int, Decimal]] = {}
        sim = _simulate(inp, inp.view, prepay)
        # A goal that pays down a debt changes the debt's later payments, which can change when the goal is funded:
        # run again with the prepayment until it stops moving.
        for _ in range(4):
            if sim["needed_prepay"] == prepay:
                break
            prepay = sim["needed_prepay"]
            sim = _simulate(inp, inp.view, prepay)
        stable = sim["needed_prepay"] == prepay
        baseline = sim if inp.view == "baseline" else _simulate(inp, "baseline", {})
        diag = _diagnostics(inp, sim)
        if not stable:
            diag["warnings"].append(_warn("goal_debt_unsettled", "warning", "A goal that pays down a debt did not settle on one answer. Treat the debt figures with care.", "goals", None, "goals"))

    rows = sim["rows"]
    opening = sim["opening"]
    final = rows[-1]["closing_balances"] if rows else opening
    as_of_index = month_to_index(inp.plan.as_of)

    def age(t: int) -> int | None:
        return None if inp.reference_age is None else inp.reference_age + t // 12

    def real(value: Decimal, t: int) -> Decimal | None:
        """A nominal amount `t` months ahead in today's money: value / (1 + inflation)^(t / 12)."""
        if inp.inflation_annual is None:
            return None
        return quantize(value / (Decimal(1) + inp.inflation_annual) ** (Decimal(t) / 12))

    checkpoints = [{"month": inp.plan.as_of, "months_ahead": 0, "age": age(0), "net_worth_real": real(opening["net_worth"], 0), "assets": opening["total_assets"], "liabilities": opening["total_liabilities"], "net_worth": opening["net_worth"], "cash": opening["cash"]}]
    marks = sorted({t for t in range(12, inp.horizon_months + 1, 12)} | {inp.horizon_months})
    for t in marks:
        c = rows[t - 1]["closing_balances"]
        checkpoints.append({"month": rows[t - 1]["month"], "months_ahead": t, "age": age(t), "net_worth_real": real(c["net_worth"], t), "assets": c["total_assets"], "liabilities": c["total_liabilities"], "net_worth": c["net_worth"], "cash": c["cash"]})

    loans_out = []
    for loan in inp.loans:
        sched = sim["schedules"][loan.id]
        payoff = index_to_month(as_of_index + sched["payoff_t"] - 1) if sched["payoff_t"] else None
        interest = sum((r["interest"] for r in sched["rows"].values()), ZERO)
        loans_out.append(
            {
                "id": loan.id,
                "name": loan.name,
                "month": payoff,
                "status": sched["status"],
                "reason": sched["reason"],
                "balance_now": loan.balance,
                "interest_in_period": quantize(interest),
            }
        )
    goals_out = []
    for goal in inp.plan.goals:
        if goal.id not in sim["goal_meta"]:
            continue
        meta = sim["goal_meta"][goal.id]
        outcome = sim["outcomes"][goal.id]
        goals_out.append(
            {
                "goal_id": goal.id,
                "label": goal.label,
                "type": goal.type,
                "status": outcome.status,
                "target_date": outcome.target_date,
                "projected_completion": outcome.projected_completion,
                "delay_months": outcome.delay_months,
                "effect": meta["effect"].effect,
                "effect_month": index_to_month(as_of_index + meta["t"] - 1) if meta["t"] and meta["t"] <= inp.horizon_months else None,
            }
        )
    base_final = baseline["rows"][-1]["closing_balances"] if baseline["rows"] else baseline["opening"]
    d = sim["drivers"]
    return {
        "model_version": MODEL_VERSION,
        "as_of": inp.plan.as_of,
        "horizon_months": inp.horizon_months,
        "view": inp.view,
        "reference_age": inp.reference_age,
        "effective_assumptions": diag["assumptions"],
        "completeness": diag["completeness"],
        "warnings": diag["warnings"],
        "provenance": diag["provenance"],
        "summary": {
            "current_assets": opening["total_assets"],
            "current_liabilities": opening["total_liabilities"],
            "current_net_worth": opening["net_worth"],
            "current_cash": opening["cash"],
            "horizon_assets": final["total_assets"],
            "horizon_liabilities": final["total_liabilities"],
            "horizon_net_worth": final["net_worth"],
            "horizon_cash": final["cash"],
            "inflation_annual": inp.inflation_annual,
            "horizon_net_worth_real": real(final["net_worth"], inp.horizon_months),
            "projected_debt_free_dates": loans_out,
            "all_debts_cleared_month": (
                max(item["month"] for item in loans_out) if loans_out and all(item["month"] for item in loans_out) else None
            ),
            "reconciles": sim["reconciles"],
        },
        "drivers": {k: quantize(v) for k, v in d.items()},
        "goals": goals_out,
        # Per-goal funding detail for in-process callers (the advisor). The API removes it before building the response.
        "goal_outcomes": [sim["outcomes"][g.id] for g in inp.plan.goals if g.id in sim["outcomes"]],
        "comparison": (
            None
            if inp.view == "baseline"
            else {
                "baseline_horizon_net_worth": base_final["net_worth"],
                "baseline_horizon_cash": base_final["cash"],
                "net_worth_difference": quantize(final["net_worth"] - base_final["net_worth"]),
                "cash_difference": quantize(final["cash"] - base_final["cash"]),
            }
        ),
        "checkpoints": checkpoints,
        "yearly": _yearly(rows, age, real),
        "opening_balances": opening,
        "monthly_ledger": rows,
    }
