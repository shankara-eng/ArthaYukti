"""Debt trajectory: each recorded debt run to payoff on the existing amortization engine, then summed by calendar year.

Nothing here is a second debt engine. Each loan goes through `calculate_amortization_schedule` exactly as the
calculator does, so a loan's trajectory and the calculator agree to the paisa. Conventions:

- The opening balance is the recorded current balance, at the start of the first month shown.
- A loan is shown only when the record can support a schedule. With no payment recorded, or a payment that does not even
  cover the monthly interest, or one that leaves a balance after the longest period the engine will run, the loan is
  reported as limited with the reason and is left out of the totals. It is never guessed.
- Unknown remaining months (recorded as 0) are not assumed: the schedule runs until the balance is paid.
- A loan whose recorded payment pays it off later than its recorded remaining months is flagged.
- The last payment of each loan is whatever clears it, as in the calculator.
"""

from decimal import Decimal
from typing import Any

from app.engine.debt import calculate_amortization_schedule
from app.timeline import index_to_month, month_to_index

ZERO = Decimal("0.00")
LONGEST = 1200  # the engine's own limit on a schedule, in months


def _dec(value: Any) -> Decimal:
    return Decimal(str(value))


def debt_trajectory(loans: list[dict[str, Any]], start_month: str) -> dict[str, Any]:
    start = month_to_index(start_month)
    rows: list[dict[str, Any]] = []
    monthly: dict[int, dict[str, Decimal]] = {}
    last_month: dict[int, Decimal] = {}  # closing balance by month index, summed across loans
    for loan in loans:
        balance, rate, payment = _dec(loan["balance"]), _dec(loan["interest_rate"]), _dec(loan["monthly_emi"])
        remaining = int(loan.get("remaining_months") or 0)
        if balance <= 0:
            continue
        base = {
            "id": loan["id"],
            "name": loan["name"],
            "opening_balance": balance,
            "annual_rate": rate,
            "monthly_payment": payment,
            "months_to_payoff": None,
            "debt_free_month": None,
            "total_interest": None,
            "total_paid": None,
            "paid_later_than_recorded": False,
        }
        if payment <= 0:
            rows.append({**base, "status": "limited", "reason": "No monthly payment is recorded for this debt, so no schedule can be worked out."})
            continue
        if payment <= balance * rate / 12:
            rows.append({**base, "status": "limited", "reason": "The recorded payment does not cover the monthly interest, so the balance would never fall."})
            continue
        try:
            result = calculate_amortization_schedule(
                principal=balance,
                annual_rate=rate,
                tenure_months=remaining if remaining > 0 else LONGEST,
                monthly_emi=payment,
            )
        except ValueError as error:
            rows.append({**base, "status": "limited", "reason": str(error)})
            continue
        schedule = result["schedule"]
        if not schedule or _dec(schedule[-1]["remaining_balance"]) > 0:
            rows.append({**base, "status": "limited", "reason": "At the recorded payment this debt is not paid off within the longest period the calculator runs."})
            continue
        months = len(schedule)
        rows.append(
            {
                **base,
                "status": "ok",
                "reason": None,
                "months_to_payoff": months,
                "debt_free_month": index_to_month(start + months - 1),
                "total_interest": _dec(result["total_interest_paid"]),
                "total_paid": _dec(result["total_amount_paid"]),
                "paid_later_than_recorded": remaining > 0 and months > remaining,
            }
        )
        for item in schedule:
            index = start + int(item["month"]) - 1
            bucket = monthly.setdefault(index, {"payments": ZERO, "principal": ZERO, "interest": ZERO})
            bucket["payments"] += _dec(item["payment"])
            bucket["principal"] += _dec(item["principal_paid"])
            bucket["interest"] += _dec(item["interest_paid"])
            last_month[index] = last_month.get(index, ZERO) + _dec(item["remaining_balance"])
        # After its last payment a loan owes nothing, so later months add nothing to the closing balance.

    # Closing balance of the whole debt at each month's end: loans still running plus nothing for paid-off ones.
    closing: dict[int, Decimal] = {}
    ok = [r for r in rows if r["status"] == "ok"]
    horizon = max((start + r["months_to_payoff"] - 1 for r in ok), default=start - 1)
    for index in range(start, horizon + 1):
        closing[index] = last_month.get(index, ZERO)

    years: dict[int, dict[str, Any]] = {}
    for index in sorted(monthly):
        year = int(index_to_month(index)[:4])
        row = years.setdefault(year, {"year": year, "months_included": 0, "payments": ZERO, "principal": ZERO, "interest": ZERO, "closing_balance": ZERO})
        row["months_included"] += 1
        row["payments"] += monthly[index]["payments"]
        row["principal"] += monthly[index]["principal"]
        row["interest"] += monthly[index]["interest"]
        row["closing_balance"] = closing[index]
    limited = [r for r in rows if r["status"] == "limited"]
    return {
        "loans": rows,
        "years": [years[y] for y in sorted(years)],
        "total_interest": sum((r["total_interest"] for r in ok), ZERO),
        "total_paid": sum((r["total_paid"] for r in ok), ZERO),
        "complete": not limited,
        "debt_free_month": index_to_month(horizon) if ok and not limited else None,
    }
