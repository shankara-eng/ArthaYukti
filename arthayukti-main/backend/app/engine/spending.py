"""The Expenditure trajectory: one deterministic, decimal-only calculation that the dashboard, the table and the CSV share.

Conventions (see docs/EXPENDITURE_PROJECTION.md):
- A month is (year, month). The projection starts in the current month, which counts as a whole month; nothing before it
  is ever projected. A yearly plan has no start or end month: it is active from January of its first year to December
  of its last, at one twelfth of the annual amount a month.
- Inflation is an annual step applied on 1 January. A plan (or a permanent change) keeps its exact amount in the year it
  begins; each following January multiplies it by (1 + rate). A plan that starts in November or December therefore never
  inflates in its starting year, and nobody is charged a second step in the same year.
- A monthly plan that ends in January to July takes no new step in its ending year; one that ends in August or later
  does. A yearly plan has no end month, so it has no such exception.
- A permanent change makes the new amount the base from its month. The old base's accumulated inflation is dropped and
  the new base begins its own steps the following January.
- A temporary override replaces the amount for its months only. The underlying plan keeps its own trajectory, so the
  month after the override ends the underlying amount resumes, with no step applied twice.
- Each plan's amount for a month is rounded half-up to the paisa; a year is the sum of those; cumulative figures are sums
  of years. The "without inflation" series sets every inflation rate to zero and keeps everything else.
"""

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from app.engine.money import ZERO, engine_context, quantize

ONE = Decimal(1)

# The predefined categories. They are constants, not rows: each person can hide them from their own list.
SYSTEM_CATEGORIES: dict[str, str] = {
    "housing": "Housing and rent",
    "groceries": "Groceries and food",
    "utilities": "Utilities and bills",
    "transport": "Transport and fuel",
    "healthcare": "Healthcare",
    "education": "Education",
    "insurance": "Insurance premiums",
    "entertainment": "Entertainment and dining out",
    "travel": "Travel and holidays",
    "personal": "Personal care and shopping",
    "family": "Family support and gifts",
    "other": "Other",
}


def month_index(year: int, month: int) -> int:
    return year * 12 + (month - 1)


def index_year_month(index: int) -> tuple[int, int]:
    return index // 12, index % 12 + 1


@dataclass(frozen=True)
class ChangeSpec:
    kind: str  # "permanent" | "temporary"
    start: int  # month index
    end: int | None  # month index, temporary only
    amount: Decimal  # in the plan's frequency, so an annual figure for a yearly plan


@dataclass(frozen=True)
class PlanSpec:
    id: str
    amount: Decimal
    frequency: str  # "monthly" | "yearly"
    start: int  # month index (January for a yearly plan)
    end: int | None  # month index (December for a yearly plan); None is ongoing
    override_rate: Decimal | None = None
    changes: tuple[ChangeSpec, ...] = field(default_factory=tuple)

    @property
    def divisor(self) -> Decimal:
        return Decimal(12) if self.frequency == "yearly" else ONE

    @property
    def end_year_month(self) -> tuple[int, int] | None:
        return None if self.end is None else index_year_month(self.end)


@dataclass(frozen=True)
class RateSchedule:
    """The global inflation rate: a starting rate and the changes that take effect from a month onward."""

    base: Decimal
    changes: tuple[tuple[int, Decimal], ...] = ()  # (month index, rate), any order

    def at(self, index: int) -> Decimal:
        rate = self.base
        for effective, new_rate in sorted(self.changes):
            if effective <= index:
                rate = new_rate
        return rate


def _step_rate(plan: PlanSpec, year: int, rates: RateSchedule, inflate: bool) -> Decimal:
    """The rate for the 1 January step into `year`."""
    if not inflate:
        return ZERO
    if plan.override_rate is not None:
        return plan.override_rate
    return rates.at(month_index(year, 1))


def monthly_amount(
    plan: PlanSpec, index: int, rates: RateSchedule, inflate: bool, memo: dict[tuple[int, int], Decimal]
) -> Decimal | None:
    """The unrounded amount a plan costs in month `index`, or None when it is not running that month."""
    if index < plan.start or (plan.end is not None and index > plan.end):
        return None
    for change in plan.changes:
        if change.kind == "temporary" and change.end is not None and change.start <= index <= change.end:
            return change.amount / plan.divisor

    base = plan.amount
    epoch = plan.start
    for change in sorted((c for c in plan.changes if c.kind == "permanent"), key=lambda c: c.start):
        if change.start <= index:
            base, epoch = change.amount, max(change.start, plan.start)
    year, _ = index_year_month(index)
    epoch_year, _ = index_year_month(epoch)

    skip_year: int | None = None
    if plan.frequency == "monthly" and plan.end is not None:
        end_year, end_month = index_year_month(plan.end)
        if end_month <= 7:
            skip_year = end_year  # a plan ending January to July takes no new step in its ending year

    if skip_year is not None and epoch_year < skip_year <= year:
        factor = ONE
        for step_year in range(epoch_year + 1, year + 1):
            if step_year != skip_year:
                factor *= ONE + _step_rate(plan, step_year, rates, inflate)
    else:
        factor = _factor(plan, epoch_year, year, rates, inflate, memo)
    return base / plan.divisor * factor


def _factor(
    plan: PlanSpec, epoch_year: int, up_to: int, rates: RateSchedule, inflate: bool, memo: dict[tuple[int, int], Decimal]
) -> Decimal:
    """The product of the January steps from the year after `epoch_year` through `up_to`, remembered as it grows."""
    if up_to <= epoch_year:
        return ONE
    key = (epoch_year, up_to)
    if key not in memo:
        memo[key] = _factor(plan, epoch_year, up_to - 1, rates, inflate, memo) * (
            ONE + _step_rate(plan, up_to, rates, inflate)
        )
    return memo[key]


@dataclass(frozen=True)
class MonthRow:
    year: int
    month: int
    with_inflation: Decimal
    without_inflation: Decimal


@dataclass(frozen=True)
class YearRow:
    year: int
    months_included: int
    annual_with_inflation: Decimal
    cumulative_with_inflation: Decimal
    cumulative_without_inflation: Decimal


@dataclass(frozen=True)
class Trajectory:
    start_year: int
    start_month: int
    horizon_months: int
    months: list[MonthRow]
    years: list[YearRow]

    @property
    def total_with_inflation(self) -> Decimal:
        return self.years[-1].cumulative_with_inflation if self.years else ZERO

    @property
    def total_without_inflation(self) -> Decimal:
        return self.years[-1].cumulative_without_inflation if self.years else ZERO


def trajectory(plans: list[PlanSpec], rates: RateSchedule, today: date, horizon_years: int) -> Trajectory:
    """Month-by-month and year-by-year spending from `today`'s month for `horizon_years` years."""
    horizon_months = horizon_years * 12
    first = month_index(today.year, today.month)
    months: list[MonthRow] = []
    with engine_context():
        memos = {(plan.id, inflate): {} for plan in plans for inflate in (True, False)}
        for offset in range(horizon_months):
            index = first + offset
            with_total = ZERO
            without_total = ZERO
            for plan in plans:
                for inflate in (True, False):
                    raw = monthly_amount(plan, index, rates, inflate, memos[(plan.id, inflate)])
                    if raw is None:
                        continue
                    if inflate:
                        with_total += quantize(raw)
                    else:
                        without_total += quantize(raw)
            year, month = index_year_month(index)
            months.append(MonthRow(year, month, with_total, without_total))

    years: list[YearRow] = []
    cumulative = ZERO
    cumulative_plain = ZERO
    for year in sorted({row.year for row in months}):
        rows = [row for row in months if row.year == year]
        annual = sum((row.with_inflation for row in rows), ZERO)
        cumulative += annual
        cumulative_plain += sum((row.without_inflation for row in rows), ZERO)
        years.append(YearRow(year, len(rows), annual, cumulative, cumulative_plain))
    return Trajectory(today.year, today.month, horizon_months, months, years)


def monthly_totals(plans: list[PlanSpec], rates: RateSchedule, first_index: int, months: int, inflate: bool = True) -> list[Decimal]:
    """The rounded total spending for `months` months starting at month index `first_index` (any start, past or future)."""
    with engine_context():
        memos: dict[str, dict[tuple[int, int], Decimal]] = {plan.id: {} for plan in plans}
        totals: list[Decimal] = []
        for offset in range(months):
            total = ZERO
            for plan in plans:
                raw = monthly_amount(plan, first_index + offset, rates, inflate, memos[plan.id])
                if raw is not None:
                    total += quantize(raw)
            totals.append(total)
    return totals
