"""Investment trajectory and SIP step-up calculation engine.

All arithmetic uses exact Decimal precision.
"""

from decimal import ROUND_HALF_UP, Decimal
from typing import Any

CENTS = Decimal("0.01")


def _quantize(val: Decimal) -> Decimal:
    return val.quantize(CENTS, rounding=ROUND_HALF_UP)


def calculate_sip_projection(
    monthly_investment: Decimal,
    annual_expected_return: Decimal,
    tenure_years: int,
    initial_investment: Decimal = Decimal("0.00"),
    step_up_percentage: Decimal = Decimal("0.00"),
    step_up_amount: Decimal = Decimal("0.00"),
    step_up_frequency_months: int = 12,
) -> dict[str, Any]:
    """Calculate future investment wealth trajectory with optional periodic step-ups.
    
    Supports:
      - Fixed monthly SIP
      - Annual percentage step-up (e.g. 10% every 12 months)
      - Fixed rupee step-up (e.g. ₹1,000 every 12 months)
      - Optional initial lump sum
    """
    if monthly_investment <= 0 and initial_investment <= 0:
        raise ValueError("Either monthly investment or initial investment must be greater than zero.")
    if tenure_years <= 0 or tenure_years > 50:
        raise ValueError("Tenure years must be between 1 and 50.")
    if annual_expected_return < 0 or annual_expected_return > 1.0:
        raise ValueError("Annual expected return must be between 0.0 and 1.0 (e.g. 0.12 for 12%).")

    total_months = tenure_years * 12
    monthly_rate = annual_expected_return / Decimal(12)

    current_sip = monthly_investment
    corpus = initial_investment
    total_invested = initial_investment
    yearly_milestones: list[dict[str, Any]] = []

    for m in range(1, total_months + 1):
        # Apply step-up at milestone frequencies (e.g., month 13, 25, 37...)
        if m > 1 and (m - 1) % step_up_frequency_months == 0:
            if step_up_percentage > 0:
                current_sip = _quantize(current_sip * (Decimal("1.0") + step_up_percentage))
            elif step_up_amount > 0:
                current_sip = current_sip + step_up_amount

        # Accrue interest for the month and add current SIP installment
        corpus = _quantize(corpus * (Decimal("1.0") + monthly_rate) + current_sip)
        total_invested += current_sip

        # Record snapshot every 12 months
        if m % 12 == 0 or m == total_months:
            year_num = m // 12
            returns_to_date = corpus - total_invested
            yearly_milestones.append({
                "year": year_num,
                "monthly_sip_amount": str(current_sip),
                "total_invested_to_date": str(total_invested),
                "estimated_returns_to_date": str(returns_to_date),
                "total_corpus": str(corpus),
            })

    estimated_returns = corpus - total_invested
    multiplier = (corpus / total_invested).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if total_invested > 0 else Decimal("1.00")

    return {
        "initial_investment": str(initial_investment),
        "starting_monthly_sip": str(monthly_investment),
        "final_monthly_sip": str(current_sip),
        "total_invested": str(total_invested),
        "estimated_returns": str(estimated_returns),
        "final_wealth": str(corpus),
        "wealth_multiplier": str(multiplier),
        "tenure_years": tenure_years,
        "yearly_milestones": yearly_milestones,
    }
