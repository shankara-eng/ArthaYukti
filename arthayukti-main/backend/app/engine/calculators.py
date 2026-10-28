"""Investment calculators: lump sum and recurring investments, valued month by month.

One engine feeds the annual tables, the compiled report, the scenario comparison and the CSV export.

Conventions (all applied everywhere):
- A rate is a nominal annual fraction compounded monthly (rate / 12), like the rest of the product.
- Months are numbered from the investment's start: month 1 is `start_month`. A lump sum is invested on the
  first day of month 1 and grows from then on. An instalment is paid at the END of its month and first grows
  the following month. Instalment k of a monthly, quarterly or annual plan falls at the end of month k*1, k*3
  or k*12, up to the end of the contribution period.
- The balance is rounded half-up to the paisa each month, so every figure is a whole number of paise and the
  annual tables reconcile exactly: opening + contributions + growth = closing.
- Year y of an investment is months 12(y-1)+1 to 12y. A step-up "from year y" applies to instalments paid
  in year y and later.
- Tax is charged once, at the valuation date: tax_rate x max(0, value - principal), where principal is every
  rupee put in up to that date. A loss is not taxed and is not netted against another investment's gain.
- Inflation adjustment divides the post-tax value by (1 + inflation/12)^months, months counted from the start
  of the investment (individual mode) or from the earliest start in the calculator (common-date mode).
- The valuation date is the end of the growth period (individual) or the end of the chosen month (common
  date). A common date earlier than maturity values the balance then, and later instalments are not made.
  A common date after maturity needs an explicit decision per investment: hold, continue, or reinvest.
"""

from dataclasses import dataclass
from decimal import Decimal

from app.engine.money import ZERO, engine_context, quantize
from app.errors import ApiError
from app.schemas.calculators import (
    CalcAggregate,
    CalcAnnualRow,
    CalcCompilation,
    CalcCompiledYear,
    CalcInvestment,
    CalcInvestmentResult,
    CalculatorConfig,
    CalculatorResult,
    MaturityDecisionNeeded,
)

FREQUENCY_STEP = {"monthly": 1, "quarterly": 3, "annual": 12}
ONE = Decimal(1)
TWELVE = Decimal(12)


def month_number(month: str) -> int:
    year, mon = month.split("-")
    return int(year) * 12 + int(mon) - 1


def month_label(number: int) -> str:
    return f"{number // 12:04d}-{number % 12 + 1:02d}"


def instalment_by_year(inv: CalcInvestment) -> dict[int, Decimal]:
    """Investment year -> the instalment in force that year, with every step-up applied from its own year."""
    if inv.sip is None:
        return {}
    sip = inv.sip
    by_year: dict[int, Decimal] = {1: sip.amount}
    current = sip.amount
    steps = {s.from_year: s for s in sip.step_ups}
    for year in range(2, sip.contribution_years + 1):
        change = steps.get(year)
        if change is not None:
            current = (
                change.amount
                if change.mode == "amount"
                else quantize(current * (ONE + change.percent))
            )  # type: ignore[operator]
        by_year[year] = current
    return by_year


def instalment_schedule(inv: CalcInvestment) -> dict[int, Decimal]:
    """Month number (1-based) -> instalment paid at the end of that month, over the contribution period."""
    if inv.sip is None:
        return {}
    by_year = instalment_by_year(inv)
    step = FREQUENCY_STEP[inv.sip.frequency]
    return {
        month: by_year[(month - 1) // 12 + 1]
        for month in range(step, inv.sip.contribution_years * 12 + 1, step)
    }


@dataclass
class Series:
    """Month-end balances and what was paid in each month, for months 0..months_valued."""

    contributions: list[Decimal]  # index 0 is the lump sum
    balances: list[Decimal]
    instalments: dict[int, Decimal]


def simulate(inv: CalcInvestment, months: int) -> Series:
    schedule = instalment_schedule(inv)
    growth_months = inv.growth_years * 12
    monthly = _monthly_rate(inv.annual_growth, inv.rate_convention)
    after = inv.after_maturity
    after_factor = ONE
    if after is not None:
        if after.action == "continue":
            after_factor = ONE + monthly
        elif after.action == "reinvest":
            after_factor = ONE + _monthly_rate(after.rate, inv.rate_convention)  # type: ignore[arg-type]
    balance = inv.lump_sum
    contributions = [inv.lump_sum]
    balances = [balance]
    for month in range(1, months + 1):
        factor = ONE + monthly if month <= growth_months else after_factor
        balance = quantize(balance * factor)
        paid = schedule.get(month, ZERO) if month <= growth_months else ZERO
        balance += paid
        contributions.append(paid)
        balances.append(balance)
    return Series(contributions, balances, {m: a for m, a in schedule.items() if m <= months})


def _monthly_rate(rate: Decimal, convention: str) -> Decimal:
    """The rate for one month. Effective annual: (1 + rate)^(1/12) - 1, so twelve months compound to exactly `rate`."""
    if convention == "effective_annual":
        return (ONE + rate) ** (ONE / TWELVE) - ONE
    return rate / TWELVE


def _deflator(rate: Decimal, months: int, convention: str = "nominal_monthly") -> Decimal:
    if rate <= 0:
        return ONE
    if convention == "effective_annual":
        return (ONE + rate) ** (Decimal(months) / TWELVE)
    return (ONE + rate / TWELVE) ** months


def _valuation_months(inv: CalcInvestment, config: CalculatorConfig) -> int:
    """Months from the investment's start to its valuation date; 0 or less means it had not started."""
    if config.mode == "individual":
        return inv.growth_years * 12
    assert config.common_date is not None
    return month_number(config.common_date) - month_number(inv.start_month) + 1


def _status(months: int, growth_months: int) -> str:
    if months <= 0:
        return "not_started"
    if months < growth_months:
        return "before_maturity"
    if months == growth_months:
        return "at_maturity"
    return "after_maturity"


def pending_decisions(config: CalculatorConfig) -> list[MaturityDecisionNeeded]:
    """Investments that mature before the common date and have no explicit after-maturity decision."""
    if config.mode != "common_date":
        return []
    needed = []
    for inv in config.investments:
        months = _valuation_months(inv, config)
        if months > inv.growth_years * 12 and inv.after_maturity is None:
            needed.append(
                MaturityDecisionNeeded(
                    investment_id=inv.id,
                    name=inv.name,
                    matures=month_label(month_number(inv.start_month) + inv.growth_years * 12 - 1),
                )
            )
    return needed


def _annual_rows(inv: CalcInvestment, series: Series, months: int) -> list[CalcAnnualRow]:
    growth_months = inv.growth_years * 12
    contribution_months = inv.sip.contribution_years * 12 if inv.sip else 0
    start = month_number(inv.start_month)
    by_year = instalment_by_year(inv)
    rows: list[CalcAnnualRow] = []
    invested = ZERO
    for year in range(1, (months + 11) // 12 + 1):
        first, last = 12 * (year - 1) + 1, min(12 * year, months)
        opening = ZERO if year == 1 else series.balances[first - 1]
        contributions = sum(series.contributions[first : last + 1], ZERO)
        if year == 1:
            contributions += series.contributions[0]
        closing = series.balances[last]
        invested += contributions
        count = sum(1 for m in range(first, last + 1) if m in series.instalments)
        in_force = by_year.get(year, ZERO)
        if last <= contribution_months:
            phase = "contributing"
        elif first <= growth_months:
            phase = "growth_only"
        else:
            phase = "after_maturity"
        rows.append(
            CalcAnnualRow(
                year=year,
                from_month=month_label(start + first - 1),
                to_month=month_label(start + last - 1),
                months=last - first + 1,
                phase=phase,
                instalment=in_force,
                instalments=count,
                opening=opening,
                contributions=contributions,
                growth=closing - opening - contributions,
                closing=closing,
                cumulative_invested=invested,
                cumulative_gain=closing - invested,
                inflation_adjusted_closing=quantize(closing / _deflator(inv.inflation_rate, last, inv.rate_convention)),
            )
        )
    return rows


def _value_investment(
    inv: CalcInvestment, config: CalculatorConfig, base_start: int
) -> CalcInvestmentResult:
    months = _valuation_months(inv, config)
    growth_months = inv.growth_years * 12
    status = _status(months, growth_months)
    if status == "not_started":
        return CalcInvestmentResult(
            id=inv.id,
            name=inv.name,
            status="not_started",
            start_month=inv.start_month,
            valuation_month=None,
            months_valued=0,
            principal=ZERO,
            value=ZERO,
            gain=ZERO,
            tax=ZERO,
            post_tax_value=ZERO,
            inflation_adjusted_value=ZERO,
            contributions_made=0,
            annual=[],
        )
    series = simulate(inv, months)
    principal = sum(series.contributions, ZERO)
    value = series.balances[months]
    gain = value - principal
    taxable = max(value, ZERO) if inv.tax_method == "total_amount" else max(gain, ZERO)
    tax = quantize(taxable * inv.tax_rate)
    post_tax = value - tax
    deflate_months = (
        months
        if config.mode == "individual"
        else months + (month_number(inv.start_month) - base_start)
    )
    real = quantize(post_tax / _deflator(inv.inflation_rate, deflate_months, inv.rate_convention))
    return CalcInvestmentResult(
        id=inv.id,
        name=inv.name,
        status=status,  # type: ignore[arg-type]
        start_month=inv.start_month,
        valuation_month=month_label(month_number(inv.start_month) + months - 1),
        months_valued=months,
        principal=principal,
        value=value,
        gain=gain,
        tax=tax,
        post_tax_value=post_tax,
        inflation_adjusted_value=real,
        contributions_made=len(series.instalments),
        annual=_annual_rows(inv, series, months),
    )


def _aggregate(results: list[CalcInvestmentResult], config: CalculatorConfig) -> CalcAggregate:
    started = [r for r in results if r.status != "not_started"]
    dates = {r.valuation_month for r in started}
    mixed = len(dates) > 1
    gains = sum((r.gain for r in started if r.gain > 0), ZERO)
    losses = sum((-r.gain for r in started if r.gain < 0), ZERO)
    real: Decimal | None = sum((r.inflation_adjusted_value for r in started), ZERO)
    if config.mode == "individual" and len(started) > 1:
        real = None  # each is deflated to its own start, so the sum would mix different money
    return CalcAggregate(
        included=len(started),
        principal=sum((r.principal for r in started), ZERO),
        value=sum((r.value for r in started), ZERO),
        gain=sum((r.gain for r in started), ZERO),
        total_gains=gains,
        total_losses=losses,
        tax=sum((r.tax for r in started), ZERO),
        post_tax_value=sum((r.post_tax_value for r in started), ZERO),
        inflation_adjusted_value=real,
        mixed_valuation_dates=mixed,
    )


def _compile(
    config: CalculatorConfig,
    results: dict[str, CalcInvestmentResult],
    ids: list[str],
    series: dict[str, Series],
) -> CalcCompilation:
    chosen = [i for i in ids if results[i].status != "not_started"]
    by_id = {inv.id: inv for inv in config.investments}
    years: list[CalcCompiledYear] = []
    if chosen:
        first = min(month_number(by_id[i].start_month) for i in chosen) // 12
        last = (
            max(month_number(by_id[i].start_month) + results[i].months_valued - 1 for i in chosen)
            // 12
        )
        cumulative = ZERO
        for year in range(first, last + 1):
            contributions = ZERO
            active = ZERO
            held = ZERO
            for i in chosen:
                start = month_number(by_id[i].start_month)
                months = results[i].months_valued
                s = series[i]
                in_year = [m for m in range(1, months + 1) if (start + m - 1) // 12 == year]
                if in_year:
                    contributions += sum((s.contributions[m] for m in in_year), ZERO)
                    if in_year[0] == 1:
                        contributions += s.contributions[0]
                    active += s.balances[in_year[-1]]
                elif (start + months - 1) // 12 < year:
                    held += s.balances[months]
            cumulative += contributions
            years.append(
                CalcCompiledYear(
                    year=year,
                    contributions=contributions,
                    closing_active=active,
                    matured_held=held,
                    closing_total=active + held,
                    cumulative_invested=cumulative,
                    cumulative_gain=active + held - cumulative,
                )
            )
    return CalcCompilation(
        investment_ids=ids,
        aggregate=_aggregate([results[i] for i in ids], config),
        years=years,
    )


def run(config: CalculatorConfig) -> CalculatorResult:
    """Value every investment, then total, compile and return one consistent result."""
    needed = pending_decisions(config)
    if needed:
        names = ", ".join(f"{item.name} (matures {item.matures})" for item in needed)
        raise ApiError(
            422,
            "maturity_decision_required",
            f"Choose what happens after maturity for: {names}.",
        )
    if config.mode == "common_date":
        assert config.common_date is not None
        longest = max(
            month_number(config.common_date) - month_number(inv.start_month) + 1
            for inv in config.investments
        )
        if longest > 1200:
            raise ApiError(
                422,
                "valuation_too_far",
                "The common date is too far after the start of an investment.",
            )
    with engine_context():
        base_start = min(month_number(inv.start_month) for inv in config.investments)
        results = [_value_investment(inv, config, base_start) for inv in config.investments]
        by_id = {r.id: r for r in results}
        series = {
            inv.id: simulate(inv, by_id[inv.id].months_valued)
            for inv in config.investments
            if by_id[inv.id].status != "not_started"
        }
        ids = (
            config.compile_ids
            if config.compile_ids is not None
            else [inv.id for inv in config.investments]
        )
        compilation = _compile(config, by_id, ids, series)
        return CalculatorResult(
            mode=config.mode,
            common_date=config.common_date,
            investments=results,
            aggregate=_aggregate(results, config),
            compilation=compilation,
        )
