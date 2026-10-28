from decimal import Decimal

from app.engine.rescue import run_rescue_analysis
from app.schemas.plan import Plan
from tests.engine.helpers import goal, load_sample_plan, make_plan


def sample_plan() -> Plan:
    return load_sample_plan("tiny_delayed_goal")


def by_strategy(result, strategy):
    return [a for a in result.alternatives if a.strategy == strategy]


def test_rescue_analysis_generates_feasible_alternatives():
    """In tiny_delayed_goal, the goal fails by 4 months. Rescue engine must propose fixes."""
    result = run_rescue_analysis(plan=sample_plan(), max_delay_months=24)
    assert result.is_baseline_feasible is False
    assert result.alternatives
    assert any(a.is_feasible for a in result.alternatives)
    assert result.recommended_alternative_id is not None


def test_ranking_criteria_and_assumptions_are_exposed():
    result = run_rescue_analysis(plan=sample_plan())
    assert "smaller remaining shortfall" in result.ranking_criteria
    assert any("never reduced" in line for line in result.assumptions)
    first = result.alternatives[0]
    assert result.recommended_alternative_id == first.alternative_id
    assert first.is_feasible


def test_rent_vs_buy_needs_an_amount_from_the_person():
    plan = sample_plan()
    no_amount = run_rescue_analysis(plan=plan, housing_mode="rent_vs_buy")
    assert by_strategy(no_amount, "rent_vs_buy") == []
    assert any("renting" in line for line in no_amount.missing_information)

    with_amount = run_rescue_analysis(
        plan=plan, housing_mode="rent_vs_buy", housing_monthly_saving=Decimal("7000.00")
    )
    (alt,) = by_strategy(with_amount, "rent_vs_buy")
    assert alt.monthly_savings_change == Decimal("7000.00")
    assert "you entered" in alt.description
    assert "not verified" in alt.description or "has not verified" in alt.description


def test_transit_vs_car_needs_an_amount_from_the_person():
    plan = sample_plan()
    no_amount = run_rescue_analysis(plan=plan, transit_mode="transit_vs_car")
    assert by_strategy(no_amount, "transit_vs_vehicle") == []
    assert any("public transport" in line for line in no_amount.missing_information)

    with_amount = run_rescue_analysis(
        plan=plan, transit_mode="transit_vs_car", transit_monthly_saving=Decimal("3000.00")
    )
    (alt,) = by_strategy(with_amount, "transit_vs_vehicle")
    assert alt.monthly_savings_change == Decimal("3000.00")


def test_no_invented_savings_amounts_anywhere():
    """Every extra saving in every alternative traces to an input the person supplied."""
    result = run_rescue_analysis(
        plan=sample_plan(), housing_mode="rent_vs_buy", transit_mode="transit_vs_car"
    )
    assert all(a.monthly_savings_change == Decimal("0.00") for a in result.alternatives)


def test_asset_sale_only_when_approved():
    plan = sample_plan()
    assert not by_strategy(run_rescue_analysis(plan=plan, allow_asset_sale=False), "asset_sale")
    sale = run_rescue_analysis(
        plan=plan, allow_asset_sale=True, asset_sale_amount=Decimal("150000.00")
    )
    (alt,) = by_strategy(sale, "asset_sale")
    assert "has not checked" in alt.description


def test_spending_cut_touches_only_expenses_marked_non_essential():
    plan = sample_plan()
    # By default expenses are essential, so no cut is offered and the reason is given.
    default = run_rescue_analysis(plan=plan)
    assert by_strategy(default, "spending_cut") == []
    assert any("non-essential" in line for line in default.missing_information)

    plan.expenses[0].essential = False
    discretionary = plan.expenses[0].monthly
    cut = run_rescue_analysis(plan=plan, allow_discretionary_cut_pct=Decimal("0.20"))
    (alt,) = by_strategy(cut, "spending_cut")
    assert alt.monthly_savings_change == (discretionary * Decimal("0.20")).quantize(Decimal("0.01"))


def _plan_with_emergency_goal(goal_id: str, kind: str) -> Plan:
    plan = make_plan(
        income="60000.00",
        expenses="40000.00",
        goals=[goal(goal_id, "240000.00", "2027-12", 1), goal("other", "300000.00", "2028-06", 2)],
    )
    plan.goals[0].type = kind
    return plan


def test_emergency_reserve_is_found_by_goal_type_not_by_id_text():
    # The id says nothing about emergencies; the type does.
    plan = _plan_with_emergency_goal("goal_1", "emergency_fund")
    result = run_rescue_analysis(plan=plan, min_emergency_reserve=Decimal("150000.00"))
    assert result.alternatives
    assert all(
        any("Emergency reserve" in v for v in a.constraints_violated) for a in result.alternatives
    )
    assert not any(a.is_feasible for a in result.alternatives)
    assert result.recommended_alternative_id is None
    assert "Emergency reserve" in (result.binding_constraint or "")


def test_an_id_that_only_sounds_like_an_emergency_fund_is_not_one():
    plan = _plan_with_emergency_goal("emergency_holiday", "custom")
    result = run_rescue_analysis(plan=plan, min_emergency_reserve=Decimal("1000.00"))
    assert result.alternatives
    assert all(
        any("No emergency-fund goal" in v for v in a.constraints_violated)
        for a in result.alternatives
    )


def test_reserve_satisfied_message_appears_only_after_the_check_passes():
    plan = sample_plan()
    ok = run_rescue_analysis(plan=plan, min_emergency_reserve=Decimal("0.00"))
    assert all(
        not any("Emergency reserve" in s for s in a.constraints_satisfied) for a in ok.alternatives
    )


def test_no_borrowing_is_only_claimed_when_it_was_requested_and_checked():
    plan = sample_plan()
    with_flag = run_rescue_analysis(plan=plan, avoid_new_debt=True)
    without_flag = run_rescue_analysis(plan=plan, avoid_new_debt=False)
    assert all(
        "No borrowing is modelled" in a.constraints_satisfied for a in with_flag.alternatives
    )
    assert all(
        "No borrowing is modelled" not in a.constraints_satisfied for a in without_flag.alternatives
    )


def test_emergency_money_is_never_delayed_or_trimmed():
    plan = _plan_with_emergency_goal("goal_1", "emergency_fund")
    plan.goals[0].current_savings = Decimal("0.00")
    result = run_rescue_analysis(plan=plan)
    for alt in result.alternatives:
        touched = {o.goal_id for o in alt.scenario.goal_overrides}
        assert "goal_1" not in touched
