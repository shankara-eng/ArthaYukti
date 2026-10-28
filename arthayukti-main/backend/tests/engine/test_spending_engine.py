"""Expenditure trajectory: every expected figure is worked out by hand in the comment beside it."""

from datetime import date
from decimal import Decimal

from app.engine.spending import ChangeSpec, PlanSpec, RateSchedule, month_index, trajectory

D = Decimal
SIX = RateSchedule(D("0.06"))


def ym(year, month):
    return month_index(year, month)


def annual(plans, today, years, rates=SIX):
    return {row.year: row.annual_with_inflation for row in trajectory(plans, rates, today, years).years}


def test_the_spec_example_ending_in_august_takes_the_full_third_year_step():
    plan = PlanSpec("a", D(5000), "monthly", ym(2028, 3), ym(2030, 8))
    # 2028: Mar-Dec = 10 x 5,000 = 50,000. 2029: 12 x 5,300 = 63,600. 2030: Jan-Aug = 8 x 5,618 = 44,944.
    assert annual([plan], date(2028, 1, 1), 3) == {2028: D("50000.00"), 2029: D("63600.00"), 2030: D("44944.00")}


def test_a_plan_ending_in_july_takes_no_new_step_in_its_ending_year():
    plan = PlanSpec("a", D(5000), "monthly", ym(2028, 3), ym(2030, 7))
    # 2030: Jan-Jul = 7 x 5,300 (the 2029 amount carries) = 37,100.
    assert annual([plan], date(2028, 1, 1), 3)[2030] == D("37100.00")


def test_a_plan_starting_in_november_is_not_inflated_in_its_starting_year():
    plan = PlanSpec("a", D(5000), "monthly", ym(2028, 11), None)
    # 2028: Nov-Dec = 2 x 5,000 = 10,000. 2029: 12 x 5,300 = 63,600.
    result = annual([plan], date(2028, 1, 1), 2)
    assert result[2028] == D("10000.00") and result[2029] == D("63600.00")


def test_a_yearly_plan_is_spread_over_twelve_months_and_not_counted_twice():
    plan = PlanSpec("a", D(24000), "yearly", ym(2028, 1), ym(2030, 12))
    # 2,000 a month; 2029: 12 x 2,120 = 25,440; 2030: 12 x 2,247.20 = 26,966.40.
    assert annual([plan], date(2028, 1, 1), 3) == {2028: D("24000.00"), 2029: D("25440.00"), 2030: D("26966.40")}


def test_a_permanent_change_replaces_the_base_and_drops_the_old_inflation():
    plan = PlanSpec("a", D(8000), "monthly", ym(2027, 1), None, changes=(ChangeSpec("permanent", ym(2028, 1), None, D(12000)),))
    # 2027: 12 x 8,000. 2028: 12 x 12,000 (a new base is not inflated in its own year). 2029: 12 x 12,720.
    assert annual([plan], date(2027, 1, 1), 3) == {2027: D("96000.00"), 2028: D("144000.00"), 2029: D("152640.00")}


def test_a_temporary_override_leaves_the_underlying_trajectory_untouched():
    plan = PlanSpec("a", D(8000), "monthly", ym(2027, 1), None, changes=(ChangeSpec("temporary", ym(2028, 1), ym(2028, 12), D(10000)),))
    # 2028 is the override, 12 x 10,000. 2029 resumes the underlying 8,000 x 1.06^2 = 8,988.80, so 12 x 8,988.80 = 107,865.60.
    assert annual([plan], date(2027, 1, 1), 3) == {2027: D("96000.00"), 2028: D("120000.00"), 2029: D("107865.60")}


def test_cumulative_without_inflation_keeps_the_scheduled_changes():
    plan = PlanSpec("a", D(8000), "monthly", ym(2027, 1), None, changes=(ChangeSpec("permanent", ym(2028, 1), None, D(12000)),))
    rows = trajectory([plan], SIX, date(2027, 1, 1), 3).years
    assert [r.cumulative_with_inflation for r in rows] == [D("96000.00"), D("240000.00"), D("392640.00")]
    assert [r.cumulative_without_inflation for r in rows] == [D("96000.00"), D("240000.00"), D("384000.00")]


def test_a_global_rate_change_applies_only_from_its_date():
    plan = PlanSpec("a", D(5000), "monthly", ym(2027, 1), None)
    rates = RateSchedule(D("0.06"), ((ym(2029, 1), D("0.08")),))
    # 2028 step at 6% -> 5,300 (63,600). 2029 step at 8% -> 5,724 (68,688).
    assert annual([plan], date(2027, 1, 1), 3, rates) == {2027: D("60000.00"), 2028: D("63600.00"), 2029: D("68688.00")}


def test_a_plan_with_its_own_rate_ignores_the_global_rate():
    plan = PlanSpec("a", D(5000), "monthly", ym(2027, 1), None, override_rate=D("0"))
    assert annual([plan], date(2027, 1, 1), 2, RateSchedule(D("0.30"))) == {2027: D("60000.00"), 2028: D("60000.00")}


def test_each_month_is_rounded_before_it_is_summed():
    plan = PlanSpec("a", D(100), "yearly", ym(2027, 1), ym(2027, 12))
    # 100 / 12 = 8.3333...; each month is 8.33, so the year is 12 x 8.33 = 99.96, not 100.00.
    assert annual([plan], date(2027, 1, 1), 1, RateSchedule(D("0")))[2027] == D("99.96")


def test_the_projection_starts_in_the_current_month_and_stops_at_the_horizon():
    plan = PlanSpec("a", D(1000), "monthly", ym(2026, 10), None)
    result = trajectory([plan], SIX, date(2026, 10, 25), 1)
    # Oct 2026 - Sep 2027: 3 months of 2026 at 1,000, 9 months of 2027 at 1,060.
    assert [(r.year, r.months_included, r.annual_with_inflation) for r in result.years] == [
        (2026, 3, D("3000.00")),
        (2027, 9, D("9540.00")),
    ]
    assert len(result.months) == 12


def test_a_plan_that_has_not_started_or_has_ended_adds_nothing():
    future = PlanSpec("f", D(1000), "monthly", ym(2030, 1), None)
    ended = PlanSpec("e", D(1000), "monthly", ym(2026, 1), ym(2026, 9))
    assert trajectory([future, ended], SIX, date(2026, 10, 25), 1).total_with_inflation == D("0.00")
    assert trajectory([], SIX, date(2026, 10, 25), 5).years[0].annual_with_inflation == D("0.00")
