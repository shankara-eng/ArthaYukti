"""Financial Trajectory: reads the signed-in person's records, hands them to the projection engine, returns the result.

Nothing here stores a record or a result. Every read is owner-scoped, a projection never changes a record, and the
request body and the figures are never logged. The balance sheet comes from the person's own account, holding, debt
and policy records; the income, spending and goals come from the plan.
"""

import hashlib
import json
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.common import AUTH_RESPONSES, VALIDATION_RESPONSES
from app.api.deps import get_current_user, get_db
from app.api.ledger import _replay, _rows, _valuation
from app.api.spending import load_spending
from app.db.models import (
    AssetInvestment,
    FinancialAccount,
    HouseholdProfile,
    InsurancePolicy,
    Liability,
    SavedPlan,
    User,
)
from app.engine.ledger import Position
from app.engine.money import ZERO
from app.engine.trajectory import (
    CLASSES,
    MODEL_VERSION,
    AccountIn,
    GoalEffectIn,
    HoldingIn,
    Inputs,
    LoanIn,
    PlannedEventIn,
    PolicyIn,
    RateIn,
    contains_insurance_spending,
    run_trajectory,
)
from app.errors import ApiError
from app.schemas.plan import Plan
from app.schemas.trajectory import TrajectoryRequest, TrajectoryResult
from app.timeline import MAX_HORIZON_MONTHS, month_to_index

router = APIRouter(prefix="/trajectory", tags=["trajectory"], responses=AUTH_RESPONSES)

CASH_TYPES = {"savings", "checking", "wallet", "other"}


def _load_plan(req: TrajectoryRequest, db: Session, user: User) -> Plan:
    if req.plan_id is not None:
        record = db.query(SavedPlan).filter(SavedPlan.id == req.plan_id, SavedPlan.user_id == user.id).first()
        if record is None:
            raise ApiError(404, "not_found", "Plan not found.")
        return Plan.model_validate_json(record.plan_json)
    assert req.plan is not None
    return req.plan


def _decimal(value: Any) -> Decimal | None:
    """A decimal from a free-form policy detail, or None when it is missing or not a number."""
    if value is None or isinstance(value, bool):
        return None
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        return None
    return number if number.is_finite() and number >= 0 else None


def _date(value: Any) -> str | None:
    if isinstance(value, str) and len(value) == 10 and value[4] == "-" and value[7] == "-":
        try:
            month_to_index(value[:7])
        except ValueError:
            return None
        return value
    return None


def _holding_in(db: Session, holding: AssetInvestment) -> HoldingIn:
    rows = _rows(db, holding)
    position = Position(quantity=Decimal(str(holding.quantity)), cost_basis=ZERO)
    if rows:
        try:
            position = _replay(rows)
        except ApiError:
            pass  # a history that no longer replays falls back to the quantity on the record
    valuation = _valuation(db, holding, position)
    return HoldingIn(
        id=holding.id,
        name=holding.asset_name,
        asset_type=holding.asset_type,
        value=valuation.value,
        basis=valuation.basis,
        status=valuation.status,
        as_of=str(valuation.as_of)[:10] if valuation.as_of else None,  # the date, not the time of day
        source=valuation.source,
        message=valuation.message,
    )


def _build_inputs(req: TrajectoryRequest, plan: Plan, db: Session, user: User) -> Inputs:
    profile = db.query(HouseholdProfile).filter(HouseholdProfile.user_id == user.id).first()
    reference_age = profile.primary_earner_age if profile is not None else None
    months = req.horizon.months
    if req.horizon.target_age is not None:
        if reference_age is None:
            raise ApiError(422, "age_reference_missing", "A horizon by age needs your current age on the User Profile. Choose a number of months, or add your age.")
        months = (req.horizon.target_age - reference_age) * 12
        if not 1 <= months <= MAX_HORIZON_MONTHS:
            raise ApiError(422, "horizon_out_of_range", f"That age is {months // 12} years from your current age. Choose an age within 1 to {MAX_HORIZON_MONTHS // 12} years ahead.")
    if months is None:
        months = 120

    accounts = db.query(FinancialAccount).filter(FinancialAccount.user_id == user.id).order_by(FinancialAccount.account_name, FinancialAccount.id).all()
    cash_accounts = [a for a in accounts if a.is_liquid and a.account_type in CASH_TYPES]
    other_accounts = [a for a in accounts if a not in cash_accounts]
    notes: list[dict] = []
    if cash_accounts:
        opening_cash = sum((Decimal(str(a.balance)) for a in cash_accounts), ZERO)
        cash_source = "Your liquid account balances"
        if plan.unassigned_savings > 0:
            notes.append(
                {
                    "code": "unassigned_savings_not_added",
                    "severity": "info",
                    "message": f"The plan also records {plan.unassigned_savings} as unassigned savings. It is not added to your account balances, so the same money is not counted twice.",
                    "component": "cash",
                    "record_id": None,
                    "edit_route": "finances",
                }
            )
    else:
        opening_cash = plan.unassigned_savings
        cash_source = "plan.unassigned_savings: the savings recorded in the plan (no liquid account balance is recorded)"
    if any(g.current_savings > 0 for g in plan.goals) and (cash_accounts or other_accounts):
        notes.append(
            {
                "code": "goal_savings_may_overlap",
                "severity": "info",
                "message": "Savings recorded on goals are counted as their own ring-fenced funds. If the same money is also in an account above, it is counted in both: lower one of them.",
                "component": "goals",
                "record_id": None,
                "edit_route": "goals",
            }
        )
    now = datetime.now(UTC).strftime("%Y-%m")
    if plan.as_of < now:
        notes.append(
            {
                "code": "plan_as_of_past",
                "severity": "info",
                "message": f"The plan starts in {plan.as_of}, earlier than this month. Your account, holding and debt balances are the figures recorded now, applied from that start.",
                "component": "plan",
                "record_id": None,
                "edit_route": "finances",
            }
        )

    holdings = db.query(AssetInvestment).filter(AssetInvestment.user_id == user.id).order_by(AssetInvestment.asset_name, AssetInvestment.id).all()
    liabilities = db.query(Liability).filter(Liability.user_id == user.id, Liability.current_balance > 0).order_by(Liability.liability_name, Liability.id).all()
    policies = db.query(InsurancePolicy).filter(InsurancePolicy.user_id == user.id).order_by(InsurancePolicy.plan_name, InsurancePolicy.id).all()

    policy_inputs: list[PolicyIn] = []
    for policy in policies:
        details: dict[str, Any] = {}
        if policy.policy_details_json:
            try:
                parsed = json.loads(policy.policy_details_json)
                details = parsed if isinstance(parsed, dict) else {}
            except ValueError:
                details = {}
        policy_inputs.append(
            PolicyIn(
                id=policy.id,
                name=f"{policy.insurer_name} {policy.plan_name}".strip(),
                policy_type=policy.policy_type,
                premium=Decimal(str(policy.premium_amount)),
                frequency=policy.premium_frequency,
                status=policy.status,
                start_date=policy.start_date,
                renewal_date=policy.renewal_date,
                expiry_date=policy.expiry_date,
                fund_value=_decimal(details.get("fund_value")),
                maturity_benefit=_decimal(details.get("maturity_benefit")),
                maturity_date=_date(details.get("maturity_date")),
            )
        )

    loans = [
        LoanIn(
            id=loan.id,
            name=loan.liability_name,
            category=loan.liability_type,
            balance=Decimal(str(loan.current_balance)),
            rate=Decimal(str(loan.interest_rate)),
            payment=Decimal(str(loan.monthly_emi)),
            remaining_months=int(loan.remaining_months or 0),
        )
        for loan in liabilities
    ]
    loan_ids = {loan.id for loan in loans}
    commitment_ids = {c.id for c in plan.commitments}
    linked: dict[str, str] = {}
    for link in req.linked_commitments:
        if link.commitment_id not in commitment_ids:
            raise ApiError(422, "unknown_commitment", f"The plan has no loan payment '{link.commitment_id}'.")
        if link.liability_id not in loan_ids:
            raise ApiError(422, "unknown_debt", "A linked debt is not one of your recorded debts with a balance.")
        if link.commitment_id in linked:
            raise ApiError(422, "duplicate_link", "A loan payment can be linked to one debt.")
        linked[link.commitment_id] = link.liability_id

    goal_ids = {g.id for g in plan.goals}
    for goal_id in req.selected_goal_ids:
        if goal_id not in goal_ids:
            raise ApiError(422, "unknown_goal", f"The plan has no goal '{goal_id}'.")
    effects: list[GoalEffectIn] = []
    for effect in req.goal_effects:
        if effect.goal_id not in req.selected_goal_ids:
            raise ApiError(422, "goal_not_selected", "A goal effect can only be set on a selected goal.")
        if effect.liability_id is not None and effect.liability_id not in loan_ids:
            raise ApiError(422, "unknown_debt", "A goal's debt is not one of your recorded debts with a balance.")
        effects.append(GoalEffectIn(effect.goal_id, effect.effect, effect.liability_id))

    non_cash = [AccountIn(a.id, a.account_name, Decimal(str(a.balance)), a.account_type, bool(a.is_liquid)) for a in other_accounts]
    holding_inputs = [_holding_in(db, h) for h in holdings]
    known_ids = {h.id for h in holding_inputs} | {a.id for a in non_cash} | {p.id for p in policy_inputs}
    rates: list[RateIn] = []
    for rate in req.return_assumptions:
        if rate.scope == "class" and rate.key not in CLASSES:
            raise ApiError(422, "unknown_class", f"'{rate.key}' is not an asset class. Use one of: {', '.join(CLASSES)}.")
        if rate.scope == "holding" and rate.key not in known_ids:
            raise ApiError(422, "unknown_holding", "A return assumption names a holding, account or policy you have not recorded.")
        rates.append(RateIn(rate.scope, rate.key, rate.annual_rate))

    as_of_index = month_to_index(plan.as_of)
    planned: list[PlannedEventIn] = []
    seen: set[str] = set()
    balances = {a.id: a.balance for a in non_cash}
    for event in req.planned_events:
        if event.id in seen:
            raise ApiError(422, "duplicate_event", "Planned event ids must be unique.")
        seen.add(event.id)
        if event.kind == "deposit_maturity":
            if event.account_id not in balances:
                raise ApiError(422, "unknown_account", "A matured deposit must be one of your recorded deposit or investment accounts.")
            if event.maturity_amount is not None and event.maturity_amount < balances[event.account_id]:
                raise ApiError(422, "maturity_below_balance", "A documented maturity value cannot be below the recorded balance.")
        index = month_to_index(event.month)
        if not as_of_index <= index < as_of_index + months:
            notes.append(
                {
                    "code": "event_outside_period",
                    "severity": "info",
                    "message": f"'{event.label}' falls outside the period shown and has no effect.",
                    "component": "events",
                    "record_id": event.id,
                    "edit_route": None,
                }
            )
        planned.append(PlannedEventIn(event.id, event.month, event.kind, event.label, event.amount, event.charges, event.account_id, event.maturity_amount))

    spending_override = None
    spending_has_premiums = False
    if req.spending_source == "expenditure_plans":
        loaded = load_spending(db, user, plan.as_of, months)
        if loaded is None:
            raise ApiError(422, "no_expenditure_plans", "You have no active plans on the Expenditure page. Add one, or use the spending in your plan.")
        spending_override, spending_has_premiums = loaded
        notes.append(
            {
                "code": "spending_from_expenditure_plans",
                "severity": "info",
                "message": "Planned spending is read from your Expenditure plans (their own inflation and scheduled changes), not from the expense lines in your plan.",
                "component": "spending",
                "record_id": None,
                "edit_route": "outlook-expenditure",
            }
        )
    if req.premiums_in_spending == "auto":
        in_spending = spending_has_premiums if spending_override is not None else contains_insurance_spending(plan)
    else:
        in_spending = req.premiums_in_spending == "yes"
    return Inputs(
        plan=plan,
        horizon_months=months,
        view=req.view,
        selected_goal_ids=list(req.selected_goal_ids),
        scenario=req.scenario,
        opening_cash=opening_cash,
        cash_source=cash_source,
        accounts=non_cash,
        holdings=holding_inputs,
        loans=loans,
        policies=policy_inputs,
        rates=rates,
        goal_effects=effects,
        planned_events=planned,
        premium_growth=req.premium_growth_annual,
        premiums_in_spending=in_spending,
        linked_commitments=linked,
        reference_age=reference_age,
        notes=notes,
        spending_override=spending_override,
        inflation_annual=req.inflation_annual,
    )


def snapshot_hash(inp: Inputs) -> str:
    """A fingerprint of everything the figures depend on. Quote ages and the clock are left out, so the same records
    always give the same hash."""
    material = {
        "model": MODEL_VERSION,
        "inflation": None if inp.inflation_annual is None else str(inp.inflation_annual),
        "plan": inp.plan.model_dump(mode="json"),
        "horizon": inp.horizon_months,
        "view": inp.view,
        "goals": sorted(inp.selected_goal_ids),
        "scenario": inp.scenario.model_dump(mode="json") if inp.scenario else None,
        "cash": str(inp.opening_cash),
        "accounts": [[a.id, str(a.balance), a.account_type, a.is_liquid] for a in inp.accounts],
        "holdings": [[h.id, h.asset_type, None if h.value is None else str(h.value), h.basis, h.as_of] for h in inp.holdings],
        "loans": [[x.id, str(x.balance), str(x.rate), str(x.payment), x.remaining_months] for x in inp.loans],
        "policies": [
            [p.id, str(p.premium), p.frequency, p.status, p.start_date, p.renewal_date, p.expiry_date, str(p.fund_value), str(p.maturity_benefit), p.maturity_date]
            for p in inp.policies
        ],
        "rates": sorted([r.scope, r.key, str(r.annual_rate)] for r in inp.rates),
        "effects": sorted([e.goal_id, e.effect, e.liability_id or ""] for e in inp.goal_effects),
        "events": [[e.id, e.month, e.kind, str(e.amount), str(e.charges), e.account_id, str(e.maturity_amount)] for e in inp.planned_events],
        "premium_growth": str(inp.premium_growth),
        "premiums_in_spending": inp.premiums_in_spending,
        "links": sorted(inp.linked_commitments.items()),
    }
    return hashlib.sha256(json.dumps(material, sort_keys=True, default=str).encode("utf-8")).hexdigest()


@router.post("/project", response_model=TrajectoryResult, responses=VALIDATION_RESPONSES)
def project_trajectory(
    req: TrajectoryRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TrajectoryResult:
    """One monthly timeline of cash, assets, liabilities, insurance and (when chosen) goals, from the person's own
    records, with the assumptions, warnings and sources it rests on. Deterministic for the same records and request."""
    plan = _load_plan(req, db, user)
    inp = _build_inputs(req, plan, db, user)
    digest = snapshot_hash(inp)
    if req.input_snapshot_hash is not None and req.input_snapshot_hash != digest:
        raise ApiError(409, "snapshot_changed", "Your records or choices changed since this was calculated. Calculate again.")
    try:
        result = run_trajectory(inp)
    except ValueError as error:
        # An input the engine refuses (for example a scenario that does not name the selected goals) is the caller's.
        raise ApiError(422, "trajectory_invalid", str(error)) from error
    result.pop("goal_outcomes", None)
    ledger = result.pop("monthly_ledger")
    if not req.include_monthly_ledger:
        ledger = None
    elif not req.include_events:
        for row in ledger:
            for name in (k for k in row if k.endswith("_events")):
                row[name] = []
    return TrajectoryResult.model_validate({**result, "input_snapshot_hash": digest, "monthly_ledger": ledger})
