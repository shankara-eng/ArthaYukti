from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.common import AUTH_RESPONSES
from app.api.deps import get_current_user, get_db
from app.db.models import Liability, User
from app.engine.debt import calculate_amortization_schedule, compare_payoff_strategies
from app.engine.debt_trajectory import debt_trajectory
from app.errors import ApiError
from app.schemas.debt import (
    AmortizationRequest,
    AmortizationResponse,
    DebtTrajectoryResponse,
    StrategyComparisonRequest,
    StrategyComparisonResponse,
)

router = APIRouter(prefix="/debt", tags=["debt"], responses=AUTH_RESPONSES)


@router.post("/amortize", response_model=AmortizationResponse)
def calculate_amortization(req: AmortizationRequest) -> AmortizationResponse:
    """Calculate complete loan amortization schedule with prepayment acceleration and interest savings."""
    try:
        res = calculate_amortization_schedule(
            principal=req.principal,
            annual_rate=req.annual_interest_rate,
            tenure_months=req.tenure_months,
            monthly_emi=req.monthly_emi,
            extra_monthly_payment=req.extra_monthly_payment,
        )
    except ValueError as error:
        # A zero balance or similar input the engine refuses is the person's input, not a server fault.
        raise ApiError(422, "debt_invalid", str(error)) from error
    if res["schedule"] and Decimal(str(res["schedule"][-1]["remaining_balance"])) > 0:
        # The schedule stops with a balance left: the payment does not cover the interest, or is too low to
        # finish the loan in a sensible time. Say so instead of showing a schedule that never ends.
        raise ApiError(
            422,
            "payment_too_low",
            "This payment is too low to pay the loan off. Raise the monthly payment above the monthly interest.",
        )
    return AmortizationResponse.model_validate(res)


@router.post("/compare-strategies", response_model=StrategyComparisonResponse)
def compare_strategies(
    req: StrategyComparisonRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StrategyComparisonResponse:
    """Compare Debt Avalanche (highest interest first) vs Debt Snowball (lowest balance first).
    
    If `debts` is omitted or empty, the caller's active liabilities from their profile are used.
    """
    owner = user
    debt_items: list[dict[str, Any]] = []

    if req.debts and len(req.debts) > 0:
        debt_items = [
            {
                "id": d.id,
                "name": d.name,
                "balance": d.balance,
                "interest_rate": d.interest_rate,
                "monthly_emi": d.monthly_emi,
            }
            for d in req.debts
        ]
    else:
        # Load from stored liabilities
        liabilities = (
            db.query(Liability)
            .filter(Liability.user_id == owner.id, Liability.current_balance > 0)
            .all()
        )
        debt_items = [
            {
                "id": liab.id,
                "name": liab.liability_name,
                "balance": liab.current_balance,
                "interest_rate": liab.interest_rate,
                "monthly_emi": liab.monthly_emi,
            }
            for liab in liabilities
        ]

    comparison = compare_payoff_strategies(debt_items, req.extra_monthly_budget)
    return StrategyComparisonResponse.model_validate(comparison)


@router.get("/strategies", response_model=StrategyComparisonResponse)
def get_user_debt_strategies(
    extra_budget: Decimal = Query(default=Decimal("0.00"), ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StrategyComparisonResponse:
    """Run Avalanche vs Snowball debt payoff analysis on the current user's recorded liabilities."""
    owner = user
    liabilities = (
        db.query(Liability)
        .filter(Liability.user_id == owner.id, Liability.current_balance > 0)
        .all()
    )
    debt_items = [
        {
            "id": liab.id,
            "name": liab.liability_name,
            "balance": liab.current_balance,
            "interest_rate": liab.interest_rate,
            "monthly_emi": liab.monthly_emi,
        }
        for liab in liabilities
    ]
    comparison = compare_payoff_strategies(debt_items, extra_budget)
    return StrategyComparisonResponse.model_validate(comparison)


@router.get("/trajectory", response_model=DebtTrajectoryResponse)
def trajectory(
    start_month: str | None = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DebtTrajectoryResponse:
    """Each recorded debt run to payoff on the amortization engine, with interest, principal and balance by year.
    A debt the record cannot support (no payment, or a payment below the interest) is listed with the reason and left
    out of the totals. Opening balances are the recorded current balances at the start of `start_month`."""
    liabilities = (
        db.query(Liability)
        .filter(Liability.user_id == user.id, Liability.current_balance > 0)
        .order_by(Liability.liability_name, Liability.id)
        .all()
    )
    month = start_month or datetime.now(UTC).strftime("%Y-%m")
    items = [
        {
            "id": liab.id,
            "name": liab.liability_name,
            "balance": liab.current_balance,
            "interest_rate": liab.interest_rate,
            "monthly_emi": liab.monthly_emi,
            "remaining_months": liab.remaining_months,
        }
        for liab in liabilities
    ]
    result = debt_trajectory(items, month)
    return DebtTrajectoryResponse.model_validate({"start_month": month, **result})
