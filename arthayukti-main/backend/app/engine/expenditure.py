"""Planned spending: the one place that turns an expense line into an amount for a month, and the year-by-year
projection built on the engine's own monthly flows.

Conventions (see also docs/EXPENDITURE_MODULE.md):
- A plain line (only `monthly`) is exactly what it always was: `monthly` times (1 + g) once every 12 months from the
  plan's first month, where g is the line's own `annual_growth` if it has one, otherwise the plan-wide
  `expense_growth_annual`.
- A scheduled line spreads its `amount` evenly over its frequency (1, 3 or 12 months). That division is NOT rounded;
  each projected month is rounded once, half-up to the paisa, after growth.
- A scheduled line is active from its start month through its end month, both inclusive (no end month: ongoing).
  Months before the plan's first month are never projected, so the first calendar year can be partial.
- Growth steps up once every 12 months counted from the later of the line's start month and the plan's first month.
  Growth is an annual step, not monthly compounding.
- Scenario spending changes are separate (they add or remove a fixed amount in a window) and are not part of a line.
"""

from decimal import Decimal

from app.engine.money import engine_context, quantize
from app.schemas.plan import FREQUENCY_MONTHS, Expense, Plan
from app.schemas.scenario import Scenario
from app.timeline import month_to_index


def line_amount(item: Expense, t: int, as_of_index: int, plan_growth: Decimal) -> Decimal | None:
    """The unrounded amount for plan month `t` (1 = the first month), or None when the line is not running."""
    growth = item.annual_growth if item.annual_growth is not None else plan_growth
    if item.start_month is None:
        return item.monthly * (1 + growth) ** ((t - 1) // 12)
    start_t = month_to_index(item.start_month) - as_of_index + 1
    if t < start_t:
        return None
    if item.end_month is not None and t > month_to_index(item.end_month) - as_of_index + 1:
        return None
    assert item.amount is not None
    anchor = max(start_t, 1)
    base = item.amount / Decimal(FREQUENCY_MONTHS[item.frequency or "monthly"])
    return base * (1 + growth) ** ((t - anchor) // 12)


def is_running(item: Expense, as_of_index: int) -> bool:
    """Whether the line is being paid in the plan's first month."""
    return line_amount(item, 1, as_of_index, Decimal(0)) is not None


def project_expenditure(plan: Plan, horizon_months: int, scenario: Scenario | None = None) -> dict[str, object]:
    """Annual and cumulative planned spending by calendar year, and the same split by line.

    The yearly totals come from the engine's own monthly spending, the number the surplus, goals and scenarios use.
    The per-line figures use the same monthly amounts, rounded the same way, so with no scenario change they add up
    to the yearly totals exactly.
    """
    from app.engine.flows import month_flows
    from app.engine.setup import resolve

    resolved = resolve(plan, scenario or Scenario())
    totals: dict[int, Decimal] = {}
    essential: dict[int, Decimal] = {}
    months: dict[int, int] = {}
    per_line: dict[str, dict[int, Decimal]] = {item.id: {} for item in plan.expenses}
    with engine_context():
        for t in range(1, horizon_months + 1):
            year = (resolved.as_of_index + t - 1) // 12
            totals[year] = totals.get(year, Decimal(0)) + month_flows(resolved, t).expenses
            months[year] = months.get(year, 0) + 1
            for item in plan.expenses:
                amount = line_amount(item, t, resolved.as_of_index, resolved.expense_growth)
                if amount is None:
                    continue
                paid = quantize(amount)
                per_line[item.id][year] = per_line[item.id].get(year, Decimal(0)) + paid
                if item.essential:
                    essential[year] = essential.get(year, Decimal(0)) + paid
    rows: list[dict[str, object]] = []
    running = Decimal(0)
    for year in sorted(totals):
        running += totals[year]
        rows.append(
            {
                "year": year,
                "months_included": months[year],
                "annual_expenditure": quantize(totals[year]),
                "cumulative_expenditure": quantize(running),
                "essential": quantize(essential.get(year, Decimal(0))),
                "discretionary": quantize(totals[year] - essential.get(year, Decimal(0))),
            }
        )
    lines = [
        {
            "id": item.id,
            "label": item.label,
            "category": item.category,
            "essential": item.essential,
            "years": [{"year": year, "amount": quantize(per_line[item.id][year])} for year in sorted(per_line[item.id])],
        }
        for item in plan.expenses
    ]
    return {"years": rows, "lines": lines}
