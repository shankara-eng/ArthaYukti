"""Debt calculation engine: Amortization schedules and Payoff Strategy comparisons (Avalanche vs. Snowball).

All financial arithmetic uses Decimal precision to prevent floating-point drift.
"""

from decimal import ROUND_HALF_UP, Decimal
from typing import Any

# Standard 2-decimal quantizer for currency
CENTS = Decimal("0.01")


def _quantize(val: Decimal) -> Decimal:
    return val.quantize(CENTS, rounding=ROUND_HALF_UP)


def calculate_emi(principal: Decimal, annual_rate: Decimal, tenure_months: int) -> Decimal:
    """Calculate monthly Equated Monthly Instalment (EMI).
    
    Formula: P * r * (1+r)^n / ((1+r)^n - 1)
    where r = annual_rate / 12.
    """
    if principal <= 0 or tenure_months <= 0:
        return Decimal("0.00")
    if annual_rate <= 0:
        return _quantize(principal / Decimal(tenure_months))

    monthly_rate = annual_rate / Decimal(12)
    # Use float for the power calculation to avoid Decimal overflow on large exponents, then cast back
    rate_factor = Decimal(str(pow(float(1 + monthly_rate), tenure_months)))
    emi = principal * monthly_rate * rate_factor / (rate_factor - Decimal(1))
    return _quantize(emi)


def calculate_amortization_schedule(
    principal: Decimal,
    annual_rate: Decimal,
    tenure_months: int,
    monthly_emi: Decimal | None = None,
    extra_monthly_payment: Decimal = Decimal("0.00"),
) -> dict[str, Any]:
    """Generate a detailed month-by-month loan amortization schedule.
    
    Supports extra monthly prepayments to calculate accelerated payoff and interest savings.
    """
    if principal <= 0:
        raise ValueError("Principal must be greater than zero.")
    if tenure_months <= 0 or tenure_months > 1200:
        raise ValueError("Tenure months must be between 1 and 1200.")
    if annual_rate < 0:
        raise ValueError("Annual interest rate cannot be negative.")

    base_emi = monthly_emi if monthly_emi and monthly_emi > 0 else calculate_emi(principal, annual_rate, tenure_months)
    monthly_rate = annual_rate / Decimal(12)

    # First calculate baseline without extra payment to know baseline interest
    baseline_interest = Decimal("0.00")
    b_bal = principal
    for _ in range(tenure_months):
        if b_bal <= 0:
            break
        int_part = _quantize(b_bal * monthly_rate)
        prin_part = base_emi - int_part
        if prin_part >= b_bal:
            baseline_interest += int_part
            break
        baseline_interest += int_part
        b_bal -= prin_part

    # Now calculate active schedule with extra payment
    balance = principal
    schedule: list[dict[str, Any]] = []
    total_interest = Decimal("0.00")
    total_paid = Decimal("0.00")
    month = 1

    max_months = tenure_months * 2  # safety boundary

    while balance > 0 and month <= max_months:
        interest_charge = _quantize(balance * monthly_rate)
        scheduled_principal = base_emi - interest_charge
        
        # Payment for this month
        actual_extra = extra_monthly_payment
        target_payment = base_emi + actual_extra

        # Check if closing loan this month
        if scheduled_principal + actual_extra >= balance or (
            month == tenure_months and extra_monthly_payment == 0 and balance < base_emi * Decimal("1.5")
        ):
            principal_paid = balance
            actual_payment = balance + interest_charge
            actual_extra = max(Decimal("0.00"), actual_payment - base_emi)
            balance = Decimal("0.00")
        else:
            principal_paid = scheduled_principal + actual_extra
            actual_payment = target_payment
            balance = balance - principal_paid

        total_interest += interest_charge
        total_paid += actual_payment

        schedule.append({
            "month": month,
            "payment": str(actual_payment),
            "principal_paid": str(principal_paid),
            "interest_paid": str(interest_charge),
            "extra_payment": str(actual_extra),
            "remaining_balance": str(balance),
        })

        if balance == 0:
            break
        month += 1

    effective_months = len(schedule)
    months_saved = max(0, tenure_months - effective_months)
    interest_saved = max(Decimal("0.00"), baseline_interest - total_interest)

    return {
        "monthly_emi": str(base_emi),
        "total_principal": str(principal),
        "total_interest_paid": str(total_interest),
        "total_amount_paid": str(total_paid),
        "effective_months": effective_months,
        "months_saved": months_saved,
        "interest_saved": str(interest_saved),
        "schedule": schedule,
    }


def compare_payoff_strategies(
    liabilities: list[dict[str, Any]],
    extra_monthly_budget: Decimal = Decimal("0.00"),
) -> dict[str, Any]:
    """Compare Debt Avalanche (highest interest rate first) vs. Debt Snowball (lowest balance first).
    
    Each liability dict expects:
      - id: str
      - name: str
      - balance: Decimal
      - interest_rate: Decimal (e.g. 0.12 for 12%)
      - monthly_emi: Decimal
    """
    if not liabilities:
        return {
            "avalanche": {"total_interest_paid": "0.00", "months_to_debt_free": 0, "payoff_order": []},
            "snowball": {"total_interest_paid": "0.00", "months_to_debt_free": 0, "payoff_order": []},
            "interest_difference": "0.00",
            "time_difference_months": 0,
            "recommendation": "No active liabilities provided.",
        }

    def _simulate(strategy: str) -> dict[str, Any]:
        # Deep copy liability states
        debts = [
            {
                "id": d["id"],
                "name": d["name"],
                "balance": Decimal(str(d["balance"])),
                "rate": Decimal(str(d["interest_rate"])),
                "min_emi": Decimal(str(d["monthly_emi"])),
            }
            for d in liabilities
            if Decimal(str(d["balance"])) > 0
        ]

        if not debts:
            return {"total_interest_paid": Decimal("0.00"), "months_to_debt_free": 0, "payoff_order": []}

        total_interest = Decimal("0.00")
        month = 0
        payoff_order: list[dict[str, Any]] = []
        max_cap = 600  # 50 years max safety cap

        while any(d["balance"] > 0 for d in debts) and month < max_cap:
            month += 1
            available_extra = extra_monthly_budget

            # Sort active debts according to strategy
            active_debts = [d for d in debts if d["balance"] > 0]
            if strategy == "avalanche":
                # Highest interest rate first
                active_debts.sort(key=lambda x: x["rate"], reverse=True)
            else:
                # Lowest balance first (Snowball)
                active_debts.sort(key=lambda x: x["balance"])

            target_debt = active_debts[0] if active_debts else None

            # First apply minimum EMIs and interest charges across all active debts
            for d in debts:
                if d["balance"] <= 0:
                    # Debt is already paid off, roll its minimum EMI into extra accelerator budget!
                    available_extra += d["min_emi"]
                    continue

                monthly_rate = d["rate"] / Decimal(12)
                interest_charge = _quantize(d["balance"] * monthly_rate)
                total_interest += interest_charge

                min_prin = d["min_emi"] - interest_charge
                if min_prin <= 0:
                    # EMI doesn't even cover interest, debt grows
                    d["balance"] += (interest_charge - d["min_emi"])
                elif min_prin >= d["balance"]:
                    # Cleared by min EMI alone
                    surplus = min_prin - d["balance"]
                    d["balance"] = Decimal("0.00")
                    available_extra += surplus
                    payoff_order.append({"id": d["id"], "name": d["name"], "payoff_month": month})
                else:
                    d["balance"] -= min_prin

            # Now apply rolled-over + extra accelerator budget exclusively to target debt
            if target_debt and target_debt["balance"] > 0 and available_extra > 0:
                if available_extra >= target_debt["balance"]:
                    target_debt["balance"] = Decimal("0.00")
                    if not any(p["id"] == target_debt["id"] for p in payoff_order):
                        payoff_order.append(
                            {"id": target_debt["id"], "name": target_debt["name"], "payoff_month": month}
                        )
                else:
                    target_debt["balance"] -= available_extra

        return {
            "total_interest_paid": _quantize(total_interest),
            "months_to_debt_free": month,
            "payoff_order": payoff_order,
        }

    avalanche_res = _simulate("avalanche")
    snowball_res = _simulate("snowball")

    interest_diff = snowball_res["total_interest_paid"] - avalanche_res["total_interest_paid"]
    time_diff = snowball_res["months_to_debt_free"] - avalanche_res["months_to_debt_free"]

    if interest_diff > 0:
        rec = (
            f"The Avalanche method saves ₹{interest_diff:,.2f} in interest and makes you debt-free "
            f"{abs(time_diff)} month(s) faster than Snowball. Choose Avalanche for maximum financial efficiency. "
            f"If behavioral motivation and quick early wins are needed, choose Snowball."
        )
    else:
        rec = (
            "Both methods produce identical or near-identical results. "
            "Choose Snowball for quick psychological momentum by extinguishing smaller balances first."
        )

    return {
        "avalanche": {
            "total_interest_paid": str(avalanche_res["total_interest_paid"]),
            "months_to_debt_free": avalanche_res["months_to_debt_free"],
            "payoff_order": avalanche_res["payoff_order"],
        },
        "snowball": {
            "total_interest_paid": str(snowball_res["total_interest_paid"]),
            "months_to_debt_free": snowball_res["months_to_debt_free"],
            "payoff_order": snowball_res["payoff_order"],
        },
        "interest_difference": str(interest_diff),
        "time_difference_months": time_diff,
        "recommendation": rec,
    }
