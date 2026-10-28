"""Investment calculators: the engine checked against hand-worked figures and an independent ledger.

The expected numbers below are worked out by hand (or with plain Decimal loops in `ledger`), never by calling
the engine. Rates are nominal annual, compounded monthly; the balance is rounded half-up to the paisa each
month; an instalment is paid at the end of its month and first grows the next month.
"""

from decimal import ROUND_HALF_UP, Decimal

import pytest

from app.engine.calculators import instalment_schedule, month_label, month_number, run
from app.errors import ApiError
from app.schemas.calculators import CalcInvestment, CalculatorConfig

D = Decimal


def q(x: Decimal) -> Decimal:
    return x.quantize(D("0.01"), rounding=ROUND_HALF_UP)


def inv(**kw) -> dict:
    base = {
        "id": "a",
        "name": "Fund A",
        "start_month": "2027-01",
        "lump_sum": "0.00",
        "growth_years": 1,
        "annual_growth": "0.000000",
    }
    base.update(kw)
    return base


def sip(amount="1000.00", years=1, frequency="monthly", steps=()):
    return {
        "amount": amount,
        "frequency": frequency,
        "contribution_years": years,
        "step_ups": list(steps),
    }


def cfg(*investments, **kw) -> CalculatorConfig:
    return CalculatorConfig.model_validate({"investments": list(investments), **kw})


def ledger(
    lump, instalments: dict[int, Decimal], rate, months, factor_after=None, growth_months=None
) -> list[Decimal]:
    """Independent month-by-month ledger: balances for months 0..months."""
    bal = D(lump)
    out = [bal]
    for m in range(1, months + 1):
        f = 1 + D(rate) / 12
        if growth_months is not None and m > growth_months:
            f = factor_after
        bal = q(bal * f) + instalments.get(m, D(0))
        out.append(bal)
    return out


# ---- lump sum ------------------------------------------------------------------------------------------


def test_lump_sum_matches_hand_worked_ladder():
    # 100000 at 12% (1% a month): 101000.00, 102010.00, 103030.10, 104060.40, 105101.00, 106152.01, 107213.53,
    # 108285.67, 109368.53, 110462.22, 111566.84, 112682.51. (Unrounded, 100000 x 1.01^12 = 112682.50.)
    result = run(cfg(inv(lump_sum="100000.00", annual_growth="0.12")))
    r = result.investments[0]
    assert r.value == D("112682.51")
    assert r.principal == D("100000.00")
    assert r.gain == D("12682.51")
    assert r.contributions_made == 0
    assert r.status == "at_maturity"


def test_zero_growth_returns_exactly_what_was_paid_in():
    result = run(cfg(inv(sip=sip("5000.00", 3), growth_years=3)))
    r = result.investments[0]
    assert r.contributions_made == 36
    assert r.principal == D("180000.00") == r.value
    assert r.gain == D("0.00") and r.tax == D("0.00")


def test_monthly_sip_one_year_matches_closed_form_and_ledger():
    # 1000 a month at 1% a month: closed form 1000 x (1.01^12 - 1) / 0.01 = 12682.503...; with monthly rounding 12682.51.
    r = run(cfg(inv(sip=sip("1000.00", 1), annual_growth="0.12"))).investments[0]
    assert r.value == D("12682.51")
    assert abs(r.value - D("12682.5030131969")) < D("0.01")
    assert r.principal == D("12000.00")
    assert r.value == ledger(0, {m: D(1000) for m in range(1, 13)}, "0.12", 12)[12]


def test_first_instalment_is_paid_at_month_end_so_it_does_not_grow_in_its_own_month():
    r = run(cfg(inv(sip=sip("1000.00", 1), annual_growth="0.12"))).investments[0]
    first_year = r.annual[0]
    # After month 1 the balance is exactly the first instalment.
    assert first_year.instalments == 12
    assert ledger(0, {m: D(1000) for m in range(1, 13)}, "0.12", 12)[1] == D("1000.00")


# ---- schedules -----------------------------------------------------------------------------------------


def test_instalment_counts_and_months_for_each_frequency():
    quarterly = CalcInvestment.model_validate(
        inv(sip=sip("30000.00", 4, "quarterly"), growth_years=4)
    )
    schedule = instalment_schedule(quarterly)
    assert sorted(schedule) == list(range(3, 49, 3)) and len(schedule) == 16
    annual = CalcInvestment.model_validate(inv(sip=sip("100000.00", 5, "annual"), growth_years=5))
    assert sorted(instalment_schedule(annual)) == [12, 24, 36, 48, 60]
    monthly = CalcInvestment.model_validate(inv(sip=sip("1.00", 2), growth_years=2))
    assert len(instalment_schedule(monthly)) == 24


def test_quarterly_and_annual_principal():
    q_result = run(cfg(inv(sip=sip("30000.00", 4, "quarterly"), growth_years=4))).investments[0]
    assert q_result.contributions_made == 16 and q_result.principal == D("480000.00")
    a_result = run(cfg(inv(sip=sip("100000.00", 5, "annual"), growth_years=5))).investments[0]
    assert a_result.contributions_made == 5 and a_result.principal == D("500000.00")


# ---- step-ups ------------------------------------------------------------------------------------------


def test_multiple_step_ups_apply_from_their_own_investment_year():
    steps = [
        {"from_year": 2, "mode": "amount", "amount": "15000.00"},
        {"from_year": 3, "mode": "percent", "percent": "0.10"},
    ]
    investment = CalcInvestment.model_validate(
        inv(sip=sip("10000.00", 3, steps=steps), growth_years=3)
    )
    schedule = instalment_schedule(investment)
    # Year 1 is months 1-12, year 2 months 13-24, year 3 months 25-36.
    assert schedule[12] == D("10000.00") and schedule[13] == D("15000.00")
    assert schedule[24] == D("15000.00") and schedule[25] == D("16500.00")  # +10% on 15000
    r = run(cfg(inv(sip=sip("10000.00", 3, steps=steps), growth_years=3))).investments[0]
    assert r.principal == D("498000.00")  # 12x10000 + 12x15000 + 12x16500
    assert [row.instalment for row in r.annual] == [D("10000.00"), D("15000.00"), D("16500.00")]


def test_percent_step_up_rounds_the_new_instalment_to_the_paisa():
    steps = [{"from_year": 2, "mode": "percent", "percent": "0.05"}]
    investment = CalcInvestment.model_validate(
        inv(sip=sip("1234.57", 2, steps=steps), growth_years=2)
    )
    assert instalment_schedule(investment)[13] == q(
        D("1234.57") * D("1.05")
    )  # 1296.2985 -> 1296.30


# ---- independent contribution and growth periods -------------------------------------------------------


def test_growth_continues_after_contributions_stop():
    r = run(cfg(inv(sip=sip("1000.00", 2), growth_years=7, annual_growth="0.12"))).investments[0]
    assert r.value == D("49002.56")  # ledger: 24 instalments, then 60 months of growth only
    assert r.principal == D("24000.00") and r.contributions_made == 24
    phases = [row.phase for row in r.annual]
    assert phases == ["contributing"] * 2 + ["growth_only"] * 5
    for row in r.annual[2:]:
        assert (
            row.contributions == D("0.00") and row.instalments == 0 and row.instalment == D("0.00")
        )


# ---- growth edge cases ---------------------------------------------------------------------------------


def test_minus_100_percent_a_year_loses_value_without_going_negative():
    # Monthly factor 1 - 1/12 = 11/12: 12000 -> 11000.00 after month 1, 4223.95 after 12 (hand ledger).
    r = run(cfg(inv(lump_sum="12000.00", annual_growth="-1.000000"))).investments[0]
    assert r.value == D("4223.95")
    assert r.gain == D("-7776.05") and r.tax == D("0.00")
    assert all(row.closing >= 0 for row in r.annual)


def test_negative_growth_is_a_loss_and_is_not_taxed():
    r = run(
        cfg(inv(lump_sum="100000.00", annual_growth="-0.100000", tax_rate="0.2000"))
    ).investments[0]
    assert r.gain < 0
    assert r.tax == D("0.00") and r.post_tax_value == r.value


# ---- tax and inflation ---------------------------------------------------------------------------------


def test_tax_is_charged_once_on_the_gain_at_the_valuation_date():
    r = run(cfg(inv(lump_sum="100000.00", annual_growth="0.12", tax_rate="0.1000"))).investments[0]
    assert r.gain == D("12682.51")
    assert r.tax == D("1268.25")  # 10% of 12682.51 = 1268.251
    assert r.post_tax_value == D("111414.26")
    # Annual rows carry no tax: they are pre-tax balances.
    assert r.annual[-1].closing == D("112682.51")


def test_inflation_adjusts_the_post_tax_value_over_the_whole_period():
    r = run(
        cfg(
            inv(
                lump_sum="100000.00",
                annual_growth="0.12",
                tax_rate="0.1000",
                inflation_rate="0.060000",
            )
        )
    ).investments[0]
    # (1 + 0.06/12)^12 = 1.06167781186...; 111414.26 / 1.06167781186 = 104941.69
    assert r.inflation_adjusted_value == D("104941.69")


def test_zero_tax_and_zero_inflation_leave_values_unchanged():
    r = run(cfg(inv(lump_sum="100000.00", annual_growth="0.12"))).investments[0]
    assert r.tax == D("0.00") and r.post_tax_value == r.value == r.inflation_adjusted_value


def test_tax_applies_to_principal_actually_paid_in_not_to_future_instalments():
    # Common date after 6 months of a 1-year SIP: only 6 instalments exist, so tax is on that principal's gain.
    config = cfg(
        inv(sip=sip("1000.00", 1), annual_growth="0.12", tax_rate="0.1000"),
        mode="common_date",
        common_date="2027-06",
    )
    r = run(config).investments[0]
    ledg = ledger(0, {m: D(1000) for m in range(1, 7)}, "0.12", 6)
    assert r.status == "before_maturity" and r.months_valued == 6
    assert r.principal == D("6000.00") and r.contributions_made == 6
    assert r.value == ledg[6]
    assert r.tax == q((ledg[6] - D(6000)) * D("0.1"))


# ---- annual reconciliation -----------------------------------------------------------------------------


def test_annual_rows_reconcile_and_chain():
    steps = [{"from_year": 3, "mode": "amount", "amount": "2500.00"}]
    r = run(
        cfg(
            inv(
                lump_sum="10000.00",
                sip=sip("2000.00", 4, "quarterly", steps),
                growth_years=6,
                annual_growth="0.09",
                tax_rate="0.1",
            )
        )
    ).investments[0]
    assert len(r.annual) == 6
    for row in r.annual:
        assert row.opening + row.contributions + row.growth == row.closing
    for prev, nxt in zip(r.annual, r.annual[1:], strict=False):
        assert nxt.opening == prev.closing
    assert r.annual[0].opening == D("0.00") and r.annual[0].contributions >= D("10000.00")
    assert sum((row.contributions for row in r.annual), D(0)) == r.principal
    assert r.annual[-1].closing == r.value
    assert r.annual[-1].cumulative_invested == r.principal
    assert r.annual[-1].cumulative_gain == r.gain
    assert r.annual[0].from_month == "2027-01" and r.annual[-1].to_month == "2032-12"


# ---- common date ---------------------------------------------------------------------------------------


def test_common_date_before_an_investment_starts_leaves_it_out():
    late = inv(
        id="late", name="Later", start_month="2030-01", lump_sum="50000.00", annual_growth="0.1"
    )
    early = inv(id="early", lump_sum="100000.00", annual_growth="0.12")
    result = run(cfg(early, late, mode="common_date", common_date="2027-12"))
    by_id = {r.id: r for r in result.investments}
    assert by_id["late"].status == "not_started" and by_id["late"].value == D("0.00")
    assert result.aggregate.included == 1 and result.aggregate.principal == D("100000.00")


def test_common_date_after_maturity_requires_an_explicit_decision():
    config = cfg(
        inv(lump_sum="100000.00", annual_growth="0.12"), mode="common_date", common_date="2028-12"
    )
    with pytest.raises(ApiError) as caught:
        run(config)
    assert caught.value.code == "maturity_decision_required"
    assert "Fund A" in caught.value.message and "2027-12" in caught.value.message


def test_after_maturity_hold_continue_and_reinvest():
    base = dict(lump_sum="100000.00", annual_growth="0.12")
    matured = run(cfg(inv(**base))).investments[0].value  # 112682.51 at the end of 2027-12
    hold = run(
        cfg(
            inv(**base, after_maturity={"action": "hold"}),
            mode="common_date",
            common_date="2028-12",
        )
    ).investments[0]
    assert hold.status == "after_maturity" and hold.months_valued == 24
    assert hold.value == matured == D("112682.51")
    cont = run(
        cfg(
            inv(**base, after_maturity={"action": "continue"}),
            mode="common_date",
            common_date="2028-12",
        )
    ).investments[0]
    assert cont.value == ledger(100000, {}, "0.12", 24)[24]
    reinvest = run(
        cfg(
            inv(**base, after_maturity={"action": "reinvest", "rate": "0.06"}),
            mode="common_date",
            common_date="2028-12",
        )
    ).investments[0]
    assert reinvest.value == ledger(100000, {}, "0.12", 24, 1 + D("0.06") / 12, 12)[24]
    # Tax is charged once, at the common date, on the whole gain.
    taxed = run(
        cfg(
            inv(**base, tax_rate="0.1", after_maturity={"action": "hold"}),
            mode="common_date",
            common_date="2028-12",
        )
    ).investments[0]
    assert taxed.tax == q((matured - D(100000)) * D("0.1"))


def test_common_date_inflation_uses_one_base_month_for_every_investment():
    a = inv(
        id="a",
        start_month="2027-01",
        lump_sum="100000.00",
        inflation_rate="0.06",
        growth_years=2,
        annual_growth="0",
    )
    b = inv(
        id="b",
        start_month="2028-01",
        lump_sum="100000.00",
        inflation_rate="0.06",
        growth_years=2,
        annual_growth="0",
    )
    result = run(cfg(a, b, mode="common_date", common_date="2028-12"))
    ra, rb = result.investments
    factor = (
        (1 + D("0.06") / 12) ** 24
    )  # both measured from 2027-01: a for 24 months, b starts 12 months later but is still deflated 24 months from the base
    assert ra.inflation_adjusted_value == q(D(100000) / factor)
    assert rb.inflation_adjusted_value == q(D(100000) / ((1 + D("0.06") / 12) ** 24))
    assert (
        result.aggregate.inflation_adjusted_value
        == ra.inflation_adjusted_value + rb.inflation_adjusted_value
    )


# ---- compile and totals --------------------------------------------------------------------------------


def two_funds():
    a = inv(
        id="a",
        name="A",
        lump_sum="20000.00",
        sip=sip("1000.00", 2),
        growth_years=3,
        annual_growth="0.1",
        tax_rate="0.1",
    )
    b = inv(
        id="b",
        name="B",
        start_month="2027-07",
        sip=sip("500.00", 1, "quarterly"),
        growth_years=2,
        annual_growth="0.08",
    )
    return a, b


def test_aggregate_is_the_sum_of_its_investments_and_losses_are_not_netted_for_tax():
    gain = inv(id="g", lump_sum="100000.00", annual_growth="0.12", tax_rate="0.1")
    loss = inv(id="l", lump_sum="100000.00", annual_growth="-0.2", tax_rate="0.1")
    result = run(cfg(gain, loss))
    g, lo = result.investments
    agg = result.aggregate
    assert agg.principal == g.principal + lo.principal
    assert agg.tax == g.tax and lo.tax == D(
        "0.00"
    )  # the loss does not reduce the other investment's tax
    assert agg.total_gains == g.gain and agg.total_losses == -lo.gain
    assert agg.gain == g.gain + lo.gain
    assert agg.post_tax_value == g.post_tax_value + lo.post_tax_value
    assert agg.mixed_valuation_dates is False


def test_compilation_reconciles_with_the_investments():
    a, b = two_funds()
    result = run(cfg(a, b))
    comp = result.compilation
    assert comp.investment_ids == ["a", "b"]
    assert sum((y.contributions for y in comp.years), D(0)) == result.aggregate.principal
    last = comp.years[-1]
    assert last.cumulative_invested == result.aggregate.principal
    assert (
        last.closing_total == result.aggregate.value
    )  # every balance is held or growing at its final value
    assert last.cumulative_gain == result.aggregate.gain
    assert [y.year for y in comp.years] == list(range(2027, 2030))
    for y in comp.years:
        assert y.closing_total == y.closing_active + y.matured_held


def test_compilation_of_a_selection_counts_only_the_selected_investments():
    a, b = two_funds()
    both = run(cfg(a, b))
    only_a = run(cfg(a, b, compile_ids=["a"]))
    assert only_a.compilation.investment_ids == ["a"]
    assert only_a.compilation.aggregate.principal == both.investments[0].principal
    assert (
        only_a.aggregate.principal == both.aggregate.principal
    )  # the main total is unaffected by the selection


def test_matured_balance_is_held_separately_from_growing_balances_in_individual_mode():
    short = inv(id="s", name="Short", lump_sum="10000.00", growth_years=1, annual_growth="0.12")
    long = inv(id="l", name="Long", lump_sum="10000.00", growth_years=3, annual_growth="0.12")
    comp = run(cfg(short, long)).compilation
    short_value = D("11268.25")  # 10000 at 1%/month for 12 months, rounded monthly
    assert comp.years[0].matured_held == D("0.00")
    assert comp.years[1].matured_held == short_value
    assert run(cfg(short, long)).aggregate.mixed_valuation_dates is True
    assert run(cfg(short, long)).aggregate.inflation_adjusted_value is None


# ---- helpers -------------------------------------------------------------------------------------------


def test_month_helpers_round_trip():
    assert month_number("2027-01") + 11 == month_number("2027-12")
    assert month_label(month_number("2027-12") + 1) == "2028-01"


def test_a_common_date_far_after_the_start_is_refused():
    config = cfg(
        inv(lump_sum="100.00", after_maturity={"action": "hold"}),
        mode="common_date",
        common_date="2200-01",
    )
    with pytest.raises(ApiError) as caught:
        run(config)
    assert caught.value.code == "valuation_too_far"


# ---- tax method and rate convention (opt-in; the defaults above are unchanged) -----------------------------------------


def one(**kw):
    return run(cfg(inv(lump_sum="100000.00", **kw))).investments[0]


def test_tax_on_the_total_amount_charges_the_whole_value_not_just_the_gain():
    # No growth: value 100,000, gain 0. Gains tax is 0; tax on the total amount at 10% is 10,000.
    assert one(tax_rate="0.100000").tax == D("0.00")
    total = one(tax_rate="0.100000", tax_method="total_amount")
    assert total.tax == D("10000.00") and total.post_tax_value == D("90000.00")


def test_tax_on_the_total_amount_is_charged_once_and_not_on_a_negative_value():
    zero = one(tax_rate="0.100000", tax_method="total_amount", annual_growth="-1.000000", rate_convention="effective_annual")
    assert zero.value == D("0.00") and zero.tax == D("0.00")  # a total loss: nothing to tax, no invalid number


def test_an_effective_annual_rate_compounds_to_exactly_that_rate_over_a_year():
    # 10% effective: twelve equal monthly steps of 1.1^(1/12) give 110,000 (to within the monthly rounding to the paisa).
    value = one(annual_growth="0.100000", rate_convention="effective_annual").value
    assert abs(value - D("110000.00")) < D("0.10")
    # The default convention is untouched: 12% nominal over twelve months is 112,682.50 unrounded, 112,682.51 with monthly rounding.
    assert one(annual_growth="0.120000").value == D("112682.51")


def test_effective_annual_inflation_divides_by_one_plus_the_rate_per_year():
    # No growth, 10% effective inflation for one year: 100,000 / 1.1 = 90,909.09 in today's money.
    assert one(inflation_rate="0.100000", rate_convention="effective_annual").inflation_adjusted_value == D("90909.09")
