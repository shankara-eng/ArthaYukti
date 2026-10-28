"""Monthly income, spending and surplus (docs/FINANCIAL_MODEL.md, section 3)."""

from dataclasses import dataclass
from decimal import Decimal

from app.engine.expenditure import line_amount
from app.engine.money import quantize
from app.engine.setup import Resolved
from app.timeline import month_to_index


@dataclass(frozen=True)
class Flows:
    income: Decimal
    expenses: Decimal
    commitments: Decimal
    one_offs: Decimal
    surplus: Decimal


def _step_up(rate: Decimal, t: int) -> Decimal:
    """Growth applied once per anniversary of the plan start: month 13 is the first step."""
    return (1 + rate) ** ((t - 1) // 12)


def stream_amount(resolved: Resolved, stream, t: int, income_factor: Decimal) -> Decimal | None:
    """One income stream's rounded take-home for plan month `t`, or None when it is not running that month.

    The surplus, the goals and the income projection all read this, so they cannot disagree."""
    year = (resolved.as_of_index + t - 1) // 12
    if stream.start_year is not None:
        # Scheduled stream: calendar years, its own growth and step-ups; plan-wide growth never applies.
        base = resolved.stream_bases.get(stream.id, {}).get(year)
        if base is None:
            return None
        amount = base
    else:
        if stream.ends_after is not None:
            last_t = month_to_index(stream.ends_after) - resolved.as_of_index + 1
            if t > last_t:
                return None
        amount = stream.monthly_net * income_factor
    for cut in resolved.income_cuts:
        if cut.from_t <= t <= cut.to_t and cut.stream_id in (None, stream.id):
            amount *= cut.multiplier
    return quantize(amount)


def month_flows(resolved: Resolved, t: int) -> Flows:
    income_factor = _step_up(resolved.income_growth, t)

    income = Decimal(0)
    for stream in resolved.streams:
        paid = stream_amount(resolved, stream, t, income_factor)
        if paid is not None:
            income += paid

    expenses = Decimal(0)
    scheduled = resolved.spending_override is not None and t in resolved.spending_override
    if scheduled:
        expenses += resolved.spending_override[t]  # type: ignore[index]
    for item in [] if scheduled else resolved.expenses:
        # A plain line is monthly x the plan-wide step-up, as always; a scheduled line follows its own dates and growth.
        amount = line_amount(item, t, resolved.as_of_index, resolved.expense_growth)
        if amount is not None:
            expenses += quantize(amount)
    for shift in resolved.expense_shifts:
        if shift.from_t <= t <= shift.to_t:
            expenses += shift.delta

    commitments = sum(
        (c.monthly_payment for c in resolved.commitments if t <= c.remaining_months),
        Decimal(0),
    )
    one_offs = resolved.one_offs.get(t, Decimal(0))

    surplus = quantize(income - expenses - commitments + one_offs + resolved.extra_monthly)
    return Flows(
        income=quantize(income),
        expenses=quantize(expenses),
        commitments=quantize(commitments),
        one_offs=quantize(one_offs),
        surplus=surplus,
    )
