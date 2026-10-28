"""Minimal-fix search and scenario comparison."""

import json
from decimal import Decimal

from app.engine.compare import compare
from app.engine.fixes import find_fixes
from app.engine.projection import project
from app.schemas.requests import SampleDetail
from app.schemas.scenario import Scenario
from tests.engine.helpers import SAMPLES, goal, load_sample_plan, make_plan


def D(value: str) -> Decimal:
    return Decimal(value)


def options_by_lever(result):
    return {option.lever: option for option in result.options}


def test_t7_the_three_levers_for_the_delayed_goal():
    result = find_fixes(load_sample_plan("tiny_delayed_goal"))
    assert result.needs_fix is True
    levers = options_by_lever(result)

    assert levers["extra_savings"].magnitude == D("10000.00")
    assert levers["extra_savings"].unit == "rupees_per_month"
    assert levers["extra_savings"].normalised_cost == D("0.556")

    assert levers["delay_goal"].magnitude == D("4")
    assert levers["delay_goal"].unit == "months"
    assert levers["delay_goal"].normalised_cost == D("0.167")

    assert levers["reduce_target"].magnitude == D("20")
    assert levers["reduce_target"].unit == "percent"
    assert levers["reduce_target"].normalised_cost == D("1.000")

    assert [option.lever for option in result.options] == [
        "delay_goal",
        "extra_savings",
        "reduce_target",
    ]
    assert result.recommended_option_id == "delay_goal:home_deposit"
    assert result.no_single_fix_reason is None


def test_every_option_is_verified_to_fix_the_plan():
    result = find_fixes(load_sample_plan("tiny_delayed_goal"))
    for option in result.options:
        assert option.result_summary.plan_feasible is True
        assert option.leaves_unresolved == []
        assert option.resolves == ["home_deposit"]


def test_applying_the_extra_savings_delta_really_fixes_it():
    plan = load_sample_plan("tiny_delayed_goal")
    option = options_by_lever(find_fixes(plan))["extra_savings"]
    assert project(plan, option.scenario_delta).summary.plan_feasible is True


def test_one_rupee_step_below_the_answer_is_not_enough():
    plan = load_sample_plan("tiny_delayed_goal")
    almost = Scenario(extra_monthly_savings="9900.00")
    assert project(plan, almost).summary.plan_feasible is False


def test_nothing_to_fix_when_the_plan_is_on_track():
    plan = load_sample_plan("tiny_delayed_goal")
    result = find_fixes(plan, Scenario(extra_monthly_savings="10000.00"))
    assert result.needs_fix is False
    assert result.options == []
    assert result.recommended_option_id is None


def test_an_impossible_plan_reports_that_no_single_change_helps():
    plan = make_plan(
        income="40000.00",
        expenses="60000.00",
        goals=[goal("g", "500000.00", "2027-10", 1)],
    )
    result = find_fixes(plan)
    assert result.needs_fix is True
    assert result.no_single_fix_reason is not None
    assert result.recommended_option_id is None
    assert all(option.leaves_unresolved for option in result.options)


def test_fixes_for_a_scenario_start_from_the_scenario():
    plan = load_sample_plan("tiny_delayed_goal")
    shock = Scenario(
        events=[
            {
                "type": "one_time_expense",
                "month": "2027-01",
                "amount": "30000.00",
                "label": "Bill",
            }
        ]
    )
    result = find_fixes(plan, shock)
    assert result.needs_fix is True
    extra = options_by_lever(result)["extra_savings"]
    combined = shock.model_copy(update={"extra_monthly_savings": extra.magnitude})
    assert project(plan, combined).summary.plan_feasible is True


def test_the_design_household_after_a_big_expense_gets_verified_options():
    sample = SampleDetail.model_validate(
        json.loads((SAMPLES / "household.json").read_text(encoding="utf-8"))
    )
    expense = next(s for s in sample.scenarios if s.name == "Sudden big expense")
    result = find_fixes(sample.plan, expense)
    assert result.needs_fix is True
    assert result.options
    for option in result.options:
        assert option.resolves or option.leaves_unresolved


def test_compare_measures_each_scenario_against_the_first():
    plan = load_sample_plan("tiny_delayed_goal")
    result = compare(
        plan,
        [Scenario(name="As is"), Scenario(name="Save more", extra_monthly_savings="10000.00")],
    )
    assert [entry.scenario_name for entry in result.results] == ["As is", "Save more"]
    assert result.results[0].summary.plan_feasible is False
    assert result.results[1].summary.plan_feasible is True
    [diff] = result.diffs
    assert diff.scenario_name == "Save more"
    assert diff.goal_id == "home_deposit"
    assert diff.completion_shift_months == -4
    assert diff.shortfall_change_today == D("-120000.00")


def test_compare_with_a_goal_that_never_completes_has_no_shift():
    plan = make_plan(
        income="40000.00",
        expenses="60000.00",
        goals=[goal("g", "500000.00", "2027-10", 1)],
    )
    result = compare(plan, [Scenario(name="A"), Scenario(name="B")])
    assert result.diffs[0].completion_shift_months is None
