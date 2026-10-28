"""The advisor's calculations (docs/AI_ADVISOR.md). Pure: no database, no network, no model.

Everything a recommendation says in numbers comes from here. The advisor never does arithmetic of its own: it asks
for one of the scenarios below, which runs the Financial Trajectory engine (and, through it, the goal allocation
engine), and reads the result.

- Goal dates: every goal is assessed at its saved target month and at exactly 36 calendar months later. The saved
  date is never changed.
- Scenarios are isolated: a scenario is a copy of the inputs with a change applied. No record is touched.
- A scenario that creates a cash shortfall, or makes a goal it did not set out to move worse, is reported infeasible.
"""

import calendar
import json
from dataclasses import dataclass, field, replace
from decimal import ROUND_DOWN, Decimal

from app.engine.money import ZERO, quantize
from app.engine.trajectory import Inputs, LoanIn, PlannedEventIn, loan_schedule, run_trajectory
from app.schemas.plan import Plan
from app.schemas.scenario import AssumptionOverrides, ExpenseChange, GoalOverride, Scenario
from app.timeline import MAX_HORIZON_MONTHS, deadline_index, index_to_month, month_to_index

ADVISOR_MODEL_VERSION = "advisor-1.0"
EXTENSION_MONTHS = 36
MAX_SCENARIO_MONTHS = 240
CASH_GROUPS = ("income_events", "expense_events", "debt_events", "insurance_events", "other_events")
STATUS_RANK = {"achievable": 0, "at_risk": 1, "underfunded": 2, "cannot_assess": 3}


class AdvisorInputError(ValueError):
    """A request the advisor cannot run, worded for the person. `code` is stable for clients."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# ---------------------------------------------------------------------------------------------------------------------
# Dates


def plus_three_years_month(month: str) -> str:
    """The same calendar month three years on. Months have no day, so there is no leap-day case."""
    return index_to_month(month_to_index(month) + EXTENSION_MONTHS)


def plus_three_years_date(day: str) -> str:
    """The same calendar day three years on. A day that does not exist then (29 February) becomes the month's last day."""
    year, month, date = int(day[:4]) + 3, int(day[5:7]), int(day[8:10])
    return f"{year:04d}-{month:02d}-{min(date, calendar.monthrange(year, month)[1]):02d}"


# ---------------------------------------------------------------------------------------------------------------------
# Running the trajectory for the advisor


class Lab:
    """Runs the trajectory on one fixed snapshot of inputs, with every goal included, and remembers each answer."""

    def __init__(self, base: Inputs) -> None:
        self.base = replace(base, view="selected_goals", scenario=None, selected_goal_ids=[g.id for g in base.plan.goals])
        self._cache: dict[str, dict] = {}

    def run(self, scenario: Scenario | None = None, events: list[PlannedEventIn] | None = None) -> dict:
        key = json.dumps([scenario.model_dump(mode="json") if scenario else None, [e.__dict__ for e in events or []]], sort_keys=True, default=str)
        if key not in self._cache:
            inp = replace(
                self.base,
                view="scenario" if scenario else "selected_goals",
                scenario=scenario,
                planned_events=[*self.base.planned_events, *(events or [])],
            )
            self._cache[key] = run_trajectory(inp)
        return self._cache[key]


def horizon_for(plan: Plan) -> int:
    """Months to project: past the latest goal date plus the three-year alternative, with a year of margin."""
    latest = max((deadline_index(plan.as_of, g.target_date) for g in plan.goals), default=12)
    return max(24, min(MAX_HORIZON_MONTHS, latest + EXTENSION_MONTHS + 12))


# ---------------------------------------------------------------------------------------------------------------------
# Goal assessments


def classify(status: str, delay_months: int | None, max_delay: int, deficit_before_deadline: bool) -> tuple[str, list[str]]:
    """Explicit criteria (also shown to the person):
    achievable   funded by the date, and cash never runs short before it;
    at risk      funded by the date but cash runs short before it, or funded late within the delay the person allows;
    underfunded  not funded, or funded later than the delay the person allows."""
    if status == "on_track":
        if deficit_before_deadline:
            return "at_risk", ["The goal is funded by its date, but cash runs short in some month before it."]
        return "achievable", []
    if status == "delayed":
        late = delay_months or 0
        if late <= max_delay:
            return "at_risk", [f"Funded {late} month(s) after the date, within the {max_delay} month(s) you said you can wait."]
        return "underfunded", [f"Funded {late} month(s) after the date, beyond the {max_delay} month(s) you said you can wait."]
    return "underfunded", ["The goal is not fully funded within the months projected."]


def assess_goal(goal, outcome, ledger: list[dict]) -> dict:
    """One goal's assessment at the date it was run with, from the engine's outcome for it."""
    deficit = any(row["month"] <= outcome.target_date and Decimal(row["uncovered_cash_deficit"]) > 0 for row in ledger)
    status, reasons = classify(outcome.status, outcome.delay_months, goal.flexibility.max_delay_months, deficit)
    return {
        "target_date": outcome.target_date,
        "target_amount_today": outcome.target_amount_today,
        "target_at_date": outcome.inflated_target_at_deadline,
        "available_funding": outcome.balance_at_deadline,
        "funding_gap": outcome.shortfall_at_deadline_nominal,
        "required_monthly": outcome.required_monthly_level_standalone,
        "projected_completion": outcome.projected_completion,
        "delay_months": outcome.delay_months,
        "status": status,
        "reasons": reasons,
        "effects_on_others": [],
    }


def cannot_assess(goal, target_date: str, reason: str) -> dict:
    return {
        "target_date": target_date,
        "target_amount_today": goal.target_amount_today,
        "target_at_date": None,
        "available_funding": None,
        "funding_gap": None,
        "required_monthly": None,
        "projected_completion": None,
        "delay_months": None,
        "status": "cannot_assess",
        "reasons": [reason],
        "effects_on_others": [],
    }


def _outcomes(result: dict) -> dict:
    return {o.goal_id: o for o in result["goal_outcomes"]}


def _starting_note(result: dict) -> str | None:
    """Said on every assessment when no account or holding is recorded: cash then starts from the plan's own figure."""
    if result["completeness"]["status"] == "insufficient":
        return "No account balance is recorded, so cash starts from the savings written in the plan. Record your balances for a firmer assessment."
    return None


def goal_caveats(goal) -> list[str]:
    notes: list[str] = []
    if goal.type == "retirement":
        notes.append("For retirement, moving the date also changes years of saving, years in retirement and spending needs. Only the saving side is calculated here; the retirement period and its spending are not modelled.")
    if goal.type == "education":
        notes.append("Education dates are usually fixed by admission and fee schedules, so a three-year delay may be impractical.")
    if goal.type == "emergency_fund":
        notes.append("Delaying an emergency fund leaves you without that cushion for three more years.")
    if goal.type == "loan_payoff":
        notes.append("A later payoff date usually means more interest paid on the loan.")
    if goal.flexibility.max_delay_months < EXTENSION_MONTHS:
        notes.append(f"You said you can wait at most {goal.flexibility.max_delay_months} month(s), less than the 36 months compared here.")
    if goal.type in ("education", "emergency_fund") or goal.flexibility.max_delay_months < EXTENSION_MONTHS:
        notes.append("time_sensitive")
    return notes


def goal_date_comparison(lab: Lab, plan: Plan) -> list[dict]:
    """Every goal at its saved date and exactly three years later. The later date is an alternative, never a change."""
    base = lab.run()
    note = _starting_note(base)
    base_outcomes = _outcomes(base)
    base_assess = {g.id: assess_goal(g, base_outcomes[g.id], base["monthly_ledger"]) for g in plan.goals if g.id in base_outcomes}
    rows: list[dict] = []
    for goal in sorted(plan.goals, key=lambda g: g.priority):
        later = plus_three_years_month(goal.target_date)
        if goal.id not in base_assess:
            original = cannot_assess(goal, goal.target_date, "This goal could not be projected.")
            plus = cannot_assess(goal, later, "This goal could not be projected.")
        else:
            original = base_assess[goal.id]
            if deadline_index(plan.as_of, later) > MAX_HORIZON_MONTHS:
                plus = cannot_assess(goal, later, f"The later date is more than {MAX_HORIZON_MONTHS} months away, beyond what is projected.")
            else:
                try:
                    scenario = Scenario(name="Goal date plus three years", goal_overrides=[GoalOverride(goal_id=goal.id, target_date=later)])
                    result = lab.run(scenario)
                    plus = assess_goal(goal, _outcomes(result)[goal.id], result["monthly_ledger"])
                    after = {g.id: assess_goal(g, _outcomes(result)[g.id], result["monthly_ledger"]) for g in plan.goals if g.id != goal.id and g.id in _outcomes(result)}
                    plus["effects_on_others"] = [
                        {"goal_id": g.id, "label": g.label, "status_before": base_assess[g.id]["status"], "status_after": after[g.id]["status"]}
                        for g in plan.goals
                        if g.id in after and g.id in base_assess and after[g.id]["status"] != base_assess[g.id]["status"]
                    ]
                except ValueError as error:
                    plus = cannot_assess(goal, later, str(error))
            if note:
                for item in (original, plus):
                    if item["status"] != "cannot_assess":
                        item["reasons"] = [*item["reasons"], note]
        notes = goal_caveats(goal)
        rows.append(
            {
                "goal_id": goal.id,
                "label": goal.label,
                "type": goal.type,
                "priority": goal.priority,
                "saved_target_date": goal.target_date,
                "target_definition": "today_money" if goal.inflation_linked else "nominal",
                "original": original,
                "plus_3_years": plus,
                "time_sensitive": "time_sensitive" in notes,
                "caveats": [n for n in notes if n != "time_sensitive"],
            }
        )
    return rows


# ---------------------------------------------------------------------------------------------------------------------
# Metrics of one run


def path_metrics(result: dict, plan: Plan) -> dict:
    ledger = result["monthly_ledger"]
    cash = [(Decimal(row["closing_balances"]["cash"]), row["month"]) for row in ledger]
    low_cash, low_month = min(cash, key=lambda item: item[0]) if cash else (Decimal(result["summary"]["current_cash"]), plan.as_of)
    first = ledger[0] if ledger else None
    operating = (
        sum((Decimal(e["cash_delta"]) for group in CASH_GROUPS for e in first[group]), ZERO) if first else None
    )
    outcomes = _outcomes(result)
    goals = []
    for goal in plan.goals:
        if goal.id not in outcomes:
            continue
        item = assess_goal(goal, outcomes[goal.id], ledger)
        goals.append(
            {
                "goal_id": goal.id,
                "label": goal.label,
                "status": item["status"],
                "target_date": item["target_date"],
                "projected_completion": item["projected_completion"],
                "funding_gap": item["funding_gap"],
            }
        )
    summary = result["summary"]
    return {
        "monthly_surplus": None if operating is None else quantize(operating),
        "minimum_cash": quantize(low_cash),
        "minimum_cash_month": low_month,
        "uncovered_cash_months": sum(1 for row in ledger if Decimal(row["uncovered_cash_deficit"]) > 0),
        "horizon_net_worth": summary["horizon_net_worth"],
        "horizon_net_worth_real": summary["horizon_net_worth_real"],
        "goals_achievable": sum(1 for g in goals if g["status"] == "achievable"),
        "goals_total": len(goals),
        "total_funding_gap": quantize(sum((Decimal(g["funding_gap"]) for g in goals), ZERO)),
        "goals": goals,
        "debt_free": [{"name": d["name"], "month": d["month"]} for d in summary["projected_debt_free_dates"]],
    }


def compare_metrics(base: dict, other: dict) -> dict:
    """What changed between two paths, from their metrics only."""

    def diff(key: str) -> str | None:
        a, b = base.get(key), other.get(key)
        return None if a is None or b is None else str(quantize(Decimal(b) - Decimal(a)))

    before = {g["goal_id"]: g for g in base["goals"]}
    changes = [
        {"goal_id": g["goal_id"], "label": g["label"], "status_before": before[g["goal_id"]]["status"], "status_after": g["status"], "gap_change": str(quantize(Decimal(g["funding_gap"]) - Decimal(before[g["goal_id"]]["funding_gap"])))}
        for g in other["goals"]
        if g["goal_id"] in before
        and (g["status"] != before[g["goal_id"]]["status"] or g["funding_gap"] != before[g["goal_id"]]["funding_gap"])
    ]
    return {
        "monthly_surplus": diff("monthly_surplus"),
        "minimum_cash": diff("minimum_cash"),
        "horizon_net_worth": diff("horizon_net_worth"),
        "horizon_net_worth_real": diff("horizon_net_worth_real"),
        "total_funding_gap": diff("total_funding_gap"),
        "goals_achievable": other["goals_achievable"] - base["goals_achievable"],
        "uncovered_cash_months": other["uncovered_cash_months"] - base["uncovered_cash_months"],
        "goal_changes": changes,
    }


def violations_for(tool: str, target_goal: str | None, base: dict, other: dict) -> list[str]:
    """Reasons a path is not feasible: it creates a cash shortfall, or makes a goal worse that it did not set out to move."""
    found: list[str] = []
    if other["uncovered_cash_months"] > base["uncovered_cash_months"]:
        found.append(f"It leaves cash short in {other['uncovered_cash_months'] - base['uncovered_cash_months']} more month(s) than today's plan.")
    if Decimal(other["minimum_cash"]) < 0:
        found.append("It takes cash below zero.")
    before = {g["goal_id"]: g for g in base["goals"]}
    for g in other["goals"]:
        was = before.get(g["goal_id"])
        if was is None or g["goal_id"] == target_goal:
            continue
        if STATUS_RANK[g["status"]] > STATUS_RANK[was["status"]]:
            found.append(f"It makes '{g['label']}' worse ({was['status'].replace('_', ' ')} to {g['status'].replace('_', ' ')}).")
    return found


# ---------------------------------------------------------------------------------------------------------------------
# Scenario builders


@dataclass
class Built:
    tool: str
    title: str
    inputs: dict
    scenario: Scenario | None = None
    planned_events: list[PlannedEventIn] = field(default_factory=list)
    assumptions: list[str] = field(default_factory=list)
    violations: list[str] = field(default_factory=list)
    details: dict = field(default_factory=dict)
    target_goal: str | None = None
    proposed_changes: list[dict] = field(default_factory=list)
    goal_effects_modelled: bool = True


def _window(plan: Plan, start: str | None, months: int | None, default_months: int = EXTENSION_MONTHS) -> tuple[str, str, int]:
    start = start or plan.as_of
    count = default_months if months is None else months
    if not 1 <= count <= MAX_SCENARIO_MONTHS:
        raise AdvisorInputError("invalid_duration", f"Duration must be between 1 and {MAX_SCENARIO_MONTHS} months.")
    first = month_to_index(start)
    if first < month_to_index(plan.as_of):
        raise AdvisorInputError("start_in_past", "The change cannot start before the plan's first month.")
    if first - month_to_index(plan.as_of) >= MAX_HORIZON_MONTHS:
        raise AdvisorInputError("start_too_far", "The start month is too far ahead.")
    return start, index_to_month(first + count - 1), count


def eligible_spending(plan: Plan, categories: list[str] | None) -> list:
    if plan.spending_schedule:
        raise AdvisorInputError(
            "no_discretionary_breakdown",
            "Your spending comes from your Expenditure plans, which do not say which part is optional. Mark optional lines in the plan to model a spending change.",
        )
    lines = [e for e in plan.expenses if not e.essential]
    if categories:
        wanted = {c.strip().lower() for c in categories}
        lines = [e for e in lines if (e.category or e.label).strip().lower() in wanted]
    if not lines:
        raise AdvisorInputError("no_eligible_spending", "There is no optional (discretionary) spending in your plan to reduce. Essential spending is never reduced.")
    return lines


def expense_change(plan: Plan, *, percent: Decimal | None, amount: Decimal | None, categories: list[str] | None, start_month: str | None, duration_months: int | None) -> Built:
    if (percent is None) == (amount is None):
        raise AdvisorInputError("percent_or_amount", "Give either a percentage or a monthly amount, not both or neither.")
    lines = eligible_spending(plan, categories)
    total = sum((e.monthly for e in lines), ZERO)
    if percent is not None:
        if not ZERO < percent <= 100:
            raise AdvisorInputError("invalid_percent", "The percentage must be above 0 and at most 100.")
        saving = quantize(total * percent / 100)
    else:
        assert amount is not None
        if amount <= 0 or amount > total:
            raise AdvisorInputError("amount_exceeds_discretionary", f"The amount must be above 0 and no more than the optional spending in the plan ({total}).")
        saving = quantize(amount)
    start, end, count = _window(plan, start_month, duration_months)
    scenario = Scenario(name="Spending change", events=[ExpenseChange(type="expense_change", from_month=start, to_month=end, delta_monthly=-saving)])
    share = saving / total if total else ZERO
    changes = [
        {"record": "expense", "id": e.id, "label": e.label, "field": "monthly", "before": str(e.monthly), "after": str(quantize(e.monthly * (1 - share)))}
        for e in lines
        if e.start_month is None
    ]
    return Built(
        tool="simulate_expense_change",
        title=f"Spend {saving} a month less on optional items",
        inputs={"percent": None if percent is None else str(percent), "amount": None if amount is None else str(amount), "categories": categories or [], "start_month": start, "duration_months": count},
        scenario=scenario,
        assumptions=[
            f"Optional spending lines total {total} a month today; essential spending is not touched.",
            f"The saving of {saving} a month runs from {start} to {end} and is used once, by the goal allocation, in priority order.",
            "The saving uses each line's amount today; lines that grow over time would save slightly more.",
        ],
        details={"monthly_saving": str(saving), "eligible_monthly_total": str(total), "start_month": start, "end_month": end},
        proposed_changes=changes,
    )


def goal_change(plan: Plan, *, goal_id: str, target_date: str | None, target_amount_today: Decimal | None) -> Built:
    goal = next((g for g in plan.goals if g.id == goal_id), None)
    if goal is None:
        raise AdvisorInputError("unknown_goal", "That goal is not in your plan.")
    if target_date is None and target_amount_today is None:
        raise AdvisorInputError("nothing_changed", "Give a new date or a new amount for the goal.")
    if target_date is not None and not 1 <= deadline_index(plan.as_of, target_date) <= MAX_HORIZON_MONTHS:
        raise AdvisorInputError("invalid_target_date", f"The date must be after the plan's start and within {MAX_HORIZON_MONTHS} months.")
    if target_amount_today is not None and target_amount_today <= 0:
        raise AdvisorInputError("invalid_amount", "The amount must be above zero.")
    scenario = Scenario(name="Goal change", goal_overrides=[GoalOverride(goal_id=goal_id, target_date=target_date, target_amount_today=target_amount_today)])
    changes = []
    if target_date is not None:
        changes.append({"record": "goal", "id": goal.id, "label": goal.label, "field": "target_date", "before": goal.target_date, "after": target_date})
    if target_amount_today is not None:
        changes.append({"record": "goal", "id": goal.id, "label": goal.label, "field": "target_amount_today", "before": str(goal.target_amount_today), "after": str(target_amount_today)})
    notes = ["The goal keeps its target definition: " + ("an amount in today's money, raised to the new date at the goal's inflation rate." if goal.inflation_linked else "a fixed amount, not adjusted for inflation.")]
    return Built(
        tool="simulate_goal_change",
        title=f"Change '{goal.label}'" + (f" to {target_date}" if target_date else ""),
        inputs={"goal_id": goal_id, "target_date": target_date, "target_amount_today": None if target_amount_today is None else str(target_amount_today)},
        scenario=scenario,
        assumptions=notes + ["Your saved goal is not changed. This only shows what would happen."],
        target_goal=goal_id,
        proposed_changes=changes,
    )


ASSUMPTIONS = {
    "savings_return_annual": (Decimal("0"), Decimal("0.30")),
    "general_inflation_annual": (Decimal("0"), Decimal("0.30")),
    "income_growth_annual": (Decimal("-0.10"), Decimal("0.30")),
    "expense_growth_annual": (Decimal("-0.10"), Decimal("0.30")),
}


def assumption_change(plan: Plan, *, name: str, new_value: Decimal) -> Built:
    if name not in ASSUMPTIONS:
        raise AdvisorInputError("unknown_assumption", f"Choose one of: {', '.join(ASSUMPTIONS)}.")
    low, high = ASSUMPTIONS[name]
    if not low <= new_value <= high:
        raise AdvisorInputError("invalid_rate", f"The rate must be between {low} and {high} (a yearly fraction, for example 0.06 for 6%).")
    old = getattr(plan.assumptions, name)
    return Built(
        tool="simulate_assumption_change",
        title=f"{name.replace('_', ' ').capitalize()}: {old} to {new_value}",
        inputs={"name": name, "old_value": str(old), "new_value": str(new_value), "scope": "whole plan"},
        scenario=Scenario(name="Assumption change", assumption_overrides=AssumptionOverrides(**{name: new_value})),
        assumptions=[f"Only {name.replace('_', ' ')} changes, for every month of the plan, from {old} to {new_value}. No return is guaranteed."],
    )


def investment_change(plan: Plan, *, amount: Decimal, frequency: str, start_month: str | None, duration_months: int | None, step_up_percent: Decimal) -> Built:
    if not ZERO < amount <= Decimal("10000000"):
        raise AdvisorInputError("invalid_amount", "The contribution must be above zero.")
    if frequency not in ("monthly", "quarterly"):
        raise AdvisorInputError("invalid_frequency", "Frequency must be monthly or quarterly.")
    if not ZERO <= step_up_percent <= 30:
        raise AdvisorInputError("invalid_step_up", "The yearly step-up must be between 0 and 30 percent.")
    start, end, count = _window(plan, start_month, duration_months)
    first = month_to_index(start)
    events: list[PlannedEventIn] = []
    for k in range(count):
        if frequency == "quarterly" and k % 3:
            continue
        paid = quantize(amount * (1 + step_up_percent / 100) ** (k // 12))
        events.append(PlannedEventIn(f"adv{k}", index_to_month(first + k), "investment_purchase", "Extra investment (advisor scenario)", paid, ZERO, None, None))
    total = sum((e.amount for e in events), ZERO)
    return Built(
        tool="simulate_investment_change",
        title=f"Invest {amount} {frequency}" + (f", rising {step_up_percent}% a year" if step_up_percent else ""),
        inputs={"amount": str(amount), "frequency": frequency, "start_month": start, "duration_months": count, "step_up_percent": str(step_up_percent)},
        planned_events=events,
        assumptions=[
            "The money moves from your cash into market investments. It is a transfer, not spending, and not new income.",
            "No return is assumed unless you have set one for market investments, so the investment shows its contributions only.",
            f"The contribution runs from {start} to {end}; it is affordable only if cash never runs short.",
        ],
        details={"total_contributed": str(quantize(total)), "contributions": len(events), "start_month": start, "end_month": end},
        goal_effects_modelled=True,
    )


def debt_strategy(loans: list[LoanIn], operating_surplus: Decimal | None, *, loan_id: str, extra: Decimal, kind: str, start_month: str | None, duration_months: int | None, as_of: str) -> Built:
    loan = next((item for item in loans if item.id == loan_id), None)
    if loan is None:
        raise AdvisorInputError("unknown_debt", "That debt is not one of your recorded debts with a balance.")
    if kind not in ("monthly", "one_time"):
        raise AdvisorInputError("invalid_kind", "Use monthly extra payments or one_time.")
    if not ZERO < extra <= Decimal("100000000"):
        raise AdvisorInputError("invalid_amount", "The extra payment must be above zero.")
    start = start_month or as_of
    first = month_to_index(start) - month_to_index(as_of) + 1
    if first < 1 or first > MAX_HORIZON_MONTHS:
        raise AdvisorInputError("invalid_start", "The start month must be within the plan.")
    count = 1 if kind == "one_time" else (duration_months or 12)
    if not 1 <= count <= MAX_SCENARIO_MONTHS:
        raise AdvisorInputError("invalid_duration", f"Duration must be between 1 and {MAX_SCENARIO_MONTHS} months.")
    base = loan_schedule(loan, MAX_HORIZON_MONTHS)
    if base["status"] not in ("ok",) or not base["rows"]:
        raise AdvisorInputError("debt_not_projectable", base["reason"] or "This debt cannot be projected from its recorded terms.")
    prepay = {first + k: quantize(extra) for k in range(count)}
    after = loan_schedule(loan, MAX_HORIZON_MONTHS, prepay)
    month_of = lambda t: None if t is None else index_to_month(month_to_index(as_of) + t - 1)  # noqa: E731
    interest = lambda sched: quantize(sum((r["interest"] for r in sched["rows"].values()), ZERO))  # noqa: E731
    paid_extra = quantize(sum((r.get("prepayment", ZERO) for r in after["rows"].values()), ZERO))
    violations = []
    if kind == "monthly" and operating_surplus is not None and extra > operating_surplus:
        violations.append(f"The extra payment of {extra} a month is more than your monthly surplus before goals ({operating_surplus}).")
    details = {
        "loan_id": loan.id,
        "loan_name": loan.name,
        "extra_total_paid": str(paid_extra),
        "payoff_before": month_of(base["payoff_t"]),
        "payoff_after": month_of(after["payoff_t"]),
        "months_saved": (base["payoff_t"] - after["payoff_t"]) if base["payoff_t"] and after["payoff_t"] else None,
        "interest_before": str(interest(base)),
        "interest_after": str(interest(after)),
        "interest_saved": str(quantize(interest(base) - interest(after))),
        "monthly_surplus_before_goals": None if operating_surplus is None else str(quantize(operating_surplus)),
    }
    return Built(
        tool="simulate_debt_strategy",
        title=f"Pay {extra} extra on '{loan.name}'" + (" once" if kind == "one_time" else f" a month for {count} month(s)"),
        inputs={"loan_id": loan_id, "extra": str(extra), "kind": kind, "start_month": start, "duration_months": count},
        assumptions=[
            "Interest and payoff dates come from the loan's recorded balance, rate, payment and remaining months.",
            "Prepayment charges and lender rules are not known, so none are applied; check them with the lender.",
            "Opportunity cost: the money paid early is not available to invest or to hold as cash. It is not valued here.",
            "How this changes goal funding is not modelled; only the loan and your monthly surplus are.",
        ],
        details=details,
        violations=violations,
        goal_effects_modelled=False,
    )


# ---------------------------------------------------------------------------------------------------------------------
# Running a built scenario


def run_built(lab: Lab, plan: Plan, built: Built, base_metrics: dict) -> dict:
    """The scenario's metrics, deltas against the baseline and a feasibility verdict. Uses the engine only."""
    if built.scenario is None and not built.planned_events:
        scenario_metrics = base_metrics  # a debt strategy changes the loan, not the trajectory
    else:
        try:
            result = lab.run(built.scenario, built.planned_events)
        except ValueError as error:
            raise AdvisorInputError("scenario_invalid", str(error)) from error
        scenario_metrics = path_metrics(result, plan)
    found = [*built.violations, *violations_for(built.tool, built.target_goal, base_metrics, scenario_metrics)]
    if built.tool == "simulate_investment_change":
        before, after = Decimal(base_metrics["minimum_cash"]), Decimal(scenario_metrics["minimum_cash"])
        if after < 0 <= before:
            found.append("It would take your cash below zero.")
    return {
        "metrics": scenario_metrics,
        "deltas": compare_metrics(base_metrics, scenario_metrics),
        "feasible": not found,
        "violations": list(dict.fromkeys(found)),
        "details": built.details,
        "goal_effects_modelled": built.goal_effects_modelled,
    }


def round_down(value: Decimal, step: Decimal) -> Decimal:
    return (value / step).to_integral_value(rounding=ROUND_DOWN) * step
