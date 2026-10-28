"""Planned income: the one place that turns an income stream into amounts per calendar year,
and the year-by-year projection built on the engine's own monthly flows.

Conventions (see also docs/INCOME_MODULE.md):
- A scheduled stream's monthly equivalent is its entered amount divided by 1, 3 or 12. That division is
  NOT rounded; each projected month is rounded once, half-up to the paisa, after growth.
- Years are calendar years. The stream is active from January of `start_year` through December of
  `end_year` (inclusive). Months before the plan's first month are never projected, so the plan's first
  calendar year can be partial.
- Base amount by year: the initial monthly equivalent in the start year; in each later year the previous
  base times (1 + annual_growth) (blank growth = 0); a step-up for that year then REPLACES the base.
  Growth after a step-up compounds from the step-up amount.
- `growth_start_year` (optional) is the first calendar year the raise is added. Before it the base stays flat. With no
  `growth_start_year` the raise is first added in the year after the start year. The raise then repeats every year.
  In a year that has both a raise and a step-up, the step-up replaces the base, so the raise is not added on top.
"""

from collections.abc import Iterable
from decimal import Decimal

from app.engine.money import engine_context, quantize
from app.schemas.plan import FREQUENCY_MONTHS, IncomeStream, Plan
from app.schemas.scenario import Scenario
from app.timeline import MAX_HORIZON_MONTHS


def yearly_bases(stream: IncomeStream, last_year: int) -> dict[int, Decimal]:
    """Unrounded monthly-equivalent base for each active calendar year of a scheduled stream."""
    assert stream.start_year is not None and stream.amount is not None
    divisor = Decimal(FREQUENCY_MONTHS[stream.frequency])
    growth = stream.annual_growth or Decimal(0)
    first_raise = stream.growth_start_year if stream.growth_start_year is not None else stream.start_year + 1
    steps = {step.year: step.amount / divisor for step in stream.step_ups}
    end = last_year if stream.end_year is None else min(stream.end_year, last_year)
    bases: dict[int, Decimal] = {}
    with engine_context():
        base = stream.amount / divisor
        for year in range(stream.start_year, end + 1):
            if year > stream.start_year and year >= first_raise:
                base = base * (1 + growth)
            if year in steps:
                base = steps[year]
            bases[year] = base
    return bases


def stream_tables(streams: Iterable[IncomeStream], as_of_index: int) -> dict[str, dict[int, Decimal]]:
    last_year = (as_of_index + MAX_HORIZON_MONTHS) // 12 + 1
    return {s.id: yearly_bases(s, last_year) for s in streams if s.start_year is not None}


def project_income(plan: Plan, horizon_months: int, scenario: Scenario | None = None) -> list[dict[str, object]]:
    """Annual and cumulative planned income for the first `horizon_months` months, by calendar year."""
    return project_income_detail(plan, horizon_months, scenario)[0]


def project_income_detail(
    plan: Plan, horizon_months: int, scenario: Scenario | None = None
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    """The yearly rows of `project_income` and, for each income stream, how it was entered and what it paid each year.

    Built from the engine's own monthly income so that this is the same number the surplus, goals and
    scenarios use. The last year of a horizon that ends mid-year only contains the months inside it.
    """
    from app.engine.flows import _step_up, month_flows, stream_amount
    from app.engine.setup import resolve

    resolved = resolve(plan, scenario or Scenario())
    years: dict[int, Decimal] = {}
    months: dict[int, int] = {}
    per_stream: dict[str, dict[int, Decimal]] = {s.id: {} for s in plan.income_streams}
    with engine_context():
        for t in range(1, horizon_months + 1):
            year = (resolved.as_of_index + t - 1) // 12
            years[year] = years.get(year, Decimal(0)) + month_flows(resolved, t).income
            months[year] = months.get(year, 0) + 1
            factor = _step_up(resolved.income_growth, t)
            for stream in plan.income_streams:
                paid = stream_amount(resolved, stream, t, factor)
                if paid is not None:
                    per_stream[stream.id][year] = per_stream[stream.id].get(year, Decimal(0)) + paid
    rows: list[dict[str, object]] = []
    running = Decimal(0)
    for year in sorted(years):
        running += years[year]
        rows.append(
            {
                "year": year,
                "months_included": months[year],
                "annual_income": quantize(years[year]),
                "cumulative_income": quantize(running),
            }
        )
    return rows, _source_rows(plan, per_stream)


def _source_rows(plan: Plan, per_stream: dict[str, dict[int, Decimal]]) -> list[dict[str, object]]:
    """Each income stream as entered, the rate it actually uses, and its own amount for every projected year."""
    out: list[dict[str, object]] = []
    for stream in plan.income_streams:
        scheduled = stream.start_year is not None
        out.append(
            {
                "id": stream.id,
                "label": stream.label,
                "kind": "scheduled" if scheduled else "legacy",
                "frequency": stream.frequency,
                "entered_amount": stream.amount if scheduled else stream.monthly_net,
                "monthly_equivalent": stream.monthly_net,
                "start_year": stream.start_year,
                "end_year": stream.end_year,
                "ends_after": stream.ends_after,
                "annual_growth": stream.annual_growth,
                "growth_start_year": stream.growth_start_year,
                # A scheduled stream uses only its own raise; a legacy one follows the plan-wide growth.
                "effective_growth_annual": (stream.annual_growth or Decimal(0))
                if scheduled
                else plan.assumptions.income_growth_annual,
                "step_ups": [{"year": step.year, "amount": step.amount} for step in sorted(stream.step_ups, key=lambda x: x.year)],
                "years": [{"year": year, "amount": quantize(per_stream[stream.id][year])} for year in sorted(per_stream[stream.id])],
            }
        )
    return out
