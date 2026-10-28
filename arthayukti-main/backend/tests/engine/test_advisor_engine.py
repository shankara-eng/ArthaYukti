"""The advisor's calculations, with hand-checked figures. Growth, inflation and returns are zero so the arithmetic stays visible.

Plan used throughout: income 100,000 a month, rent 40,000 (essential), dining 10,000 (optional), so the surplus is 50,000.
One goal needs 700,000 within 12 months (2027-01 to 2027-12): 12 x 50,000 = 600,000, a gap of 100,000, funded in month 14.
"""

from decimal import Decimal

import pytest

from app.ai.advisor import figures_in, unsupported_figures
from app.engine import advisor as adv
from app.engine.trajectory import LoanIn
from app.schemas.plan import Plan
from tests.test_trajectory_engine import D, make_inputs


def plan(expenses=(("Rent", "40000.00", True), ("Dining", "10000.00", False)), goals=None):
    return Plan.model_validate(
        {
            "name": "T",
            "as_of": "2027-01",
            "currency": "INR",
            "income_streams": [{"id": "inc", "label": "Salary", "monthly_net": "100000.00", "ends_after": None}],
            "expenses": [{"id": f"e{i}", "label": label, "monthly": amount, "essential": essential} for i, (label, amount, essential) in enumerate(expenses)],
            "commitments": [],
            "unassigned_savings": "0.00",
            "goals": goals
            or [{"id": "trip", "label": "Trip", "type": "custom", "target_amount_today": "700000.00", "target_date": "2027-12", "priority": 1, "inflation_linked": False, "current_savings": "0.00"}],
            "assumptions": {"general_inflation_annual": "0.050000", "savings_return_annual": "0.000000", "income_growth_annual": "0.000000", "expense_growth_annual": "0.000000"},
        }
    )


def lab_for(p: Plan, cash="0.00", **kw) -> adv.Lab:
    return adv.Lab(make_inputs(p, months=adv.horizon_for(p), cash=cash, **kw))


# --- dates --------------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(("month", "later"), [("2026-11", "2029-11"), ("2027-12", "2030-12"), ("2027-01", "2030-01"), ("2028-02", "2031-02")])
def test_a_month_moves_by_exactly_36_calendar_months(month, later):
    assert adv.plus_three_years_month(month) == later


@pytest.mark.parametrize(
    ("day", "later"),
    [("2028-02-29", "2031-02-28"), ("2024-02-29", "2027-02-28"), ("2025-01-31", "2028-01-31"), ("2026-12-31", "2029-12-31"), ("2025-02-28", "2028-02-28"), ("2021-02-28", "2024-02-28")],
)
def test_a_day_that_does_not_exist_three_years_later_becomes_the_months_last_day(day, later):
    assert adv.plus_three_years_date(day) == later


# --- goal assessment ----------------------------------------------------------------------------------------------------


def test_original_and_plus_three_years_are_assessed_separately():
    p = plan()
    row = adv.goal_date_comparison(lab_for(p), p)[0]
    o, later = row["original"], row["plus_3_years"]
    assert row["saved_target_date"] == "2027-12" and later["target_date"] == "2030-12"
    # 12 x 50,000 = 600,000 by the date against a target of 700,000: a gap of 100,000, funded in month 14 (2 months late)
    assert D(o["available_funding"]) == 600000 and D(o["funding_gap"]) == 100000 and o["delay_months"] == 2
    assert o["status"] == "at_risk"  # late, but within the 24 months the person allows
    # three years later the same money funds it in month 14, well inside 48 months: nothing is copied from the first answer
    assert later["status"] == "achievable" and D(later["funding_gap"]) == 0 and later["delay_months"] == 0
    assert D(later["required_monthly"]) < D(o["required_monthly"])  # 700000 / 48 months against 700000 / 12 months
    assert row["target_definition"] == "nominal"


def test_an_achievable_goal_is_still_assessed_three_years_later():
    p = plan(goals=[{"id": "trip", "label": "Trip", "type": "custom", "target_amount_today": "500000.00", "target_date": "2027-12", "priority": 1, "inflation_linked": False, "current_savings": "0.00"}])
    row = adv.goal_date_comparison(lab_for(p), p)[0]
    assert row["original"]["status"] == "achievable" and row["plus_3_years"]["status"] == "achievable"
    assert row["plus_3_years"]["target_date"] == "2030-12"


def test_a_goal_in_today_money_is_inflated_to_the_later_date():
    p = plan(goals=[{"id": "trip", "label": "Trip", "type": "custom", "target_amount_today": "500000.00", "target_date": "2027-12", "priority": 1, "inflation_linked": True, "current_savings": "0.00"}])
    row = adv.goal_date_comparison(lab_for(p), p)[0]
    assert row["target_definition"] == "today_money"
    assert D(row["plus_3_years"]["target_at_date"]) > D(row["original"]["target_at_date"]) > D("500000.00")


def test_competing_goals_share_one_surplus_and_the_extension_shows_its_effect_on_the_other():
    goals = [
        {"id": "a", "label": "A", "type": "custom", "target_amount_today": "300000.00", "target_date": "2027-12", "priority": 1, "inflation_linked": False, "current_savings": "0.00"},
        {"id": "b", "label": "B", "type": "custom", "target_amount_today": "400000.00", "target_date": "2027-12", "priority": 2, "inflation_linked": False, "current_savings": "0.00"},
    ]
    p = plan(goals=goals)
    rows = {r["goal_id"]: r for r in adv.goal_date_comparison(lab_for(p), p)}
    # 600,000 is available by December: A (300,000) is funded first; B gets the remaining 300,000 of 400,000
    assert rows["a"]["original"]["status"] == "achievable"
    assert D(rows["b"]["original"]["available_funding"]) == 300000 and D(rows["b"]["original"]["funding_gap"]) == 100000
    # moving A three years later frees money for B within the year: the effect on the other goal is reported
    effects = rows["a"]["plus_3_years"]["effects_on_others"]
    assert [e["goal_id"] for e in effects] == ["b"] and effects[0]["status_before"] != effects[0]["status_after"]


def test_retirement_and_time_sensitive_goals_carry_caveats():
    goals = [
        {"id": "r", "label": "Retire", "type": "retirement", "target_amount_today": "500000.00", "target_date": "2027-12", "priority": 1, "inflation_linked": False, "current_savings": "0.00"},
        {"id": "e", "label": "Fees", "type": "education", "target_amount_today": "100000.00", "target_date": "2027-12", "priority": 2, "inflation_linked": False, "current_savings": "0.00"},
    ]
    p = plan(goals=goals)
    rows = {r["goal_id"]: r for r in adv.goal_date_comparison(lab_for(p), p)}
    assert any("not modelled" in c for c in rows["r"]["caveats"])
    assert rows["e"]["time_sensitive"] is True and any("impractical" in c for c in rows["e"]["caveats"])


def test_a_later_date_beyond_the_projection_limit_cannot_be_assessed():
    p = plan(goals=[{"id": "far", "label": "Far", "type": "custom", "target_amount_today": "100000.00", "target_date": "2075-01", "priority": 1, "inflation_linked": False, "current_savings": "0.00"}])
    row = adv.goal_date_comparison(lab_for(p), p)[0]
    assert row["plus_3_years"]["status"] == "cannot_assess" and "600" in row["plus_3_years"]["reasons"][0]


@pytest.mark.parametrize(
    ("status", "delay", "deficit", "expected"),
    [("on_track", None, False, "achievable"), ("on_track", None, True, "at_risk"), ("delayed", 3, False, "at_risk"), ("delayed", 30, False, "underfunded"), ("not_achievable", None, False, "underfunded")],
)
def test_status_criteria(status, delay, deficit, expected):
    assert adv.classify(status, delay, 24, deficit)[0] == expected


# --- scenarios ----------------------------------------------------------------------------------------------------------


def test_a_percentage_spending_cut_is_exact_and_leaves_essentials_alone():
    p = plan()
    built = adv.expense_change(p, percent=D("10"), amount=None, categories=None, start_month=None, duration_months=12)
    assert built.details["monthly_saving"] == "1000.00"  # 10% of the 10,000 optional line; rent is untouched
    lab = lab_for(p)
    base = adv.path_metrics(lab.run(), p)
    ran = adv.run_built(lab, p, built, base)
    # 12 x 1,000 more saved by the deadline: the gap falls from 100,000 to 88,000, and nothing is double-counted
    assert D(ran["metrics"]["goals"][0]["funding_gap"]) == 88000
    assert D(ran["deltas"]["total_funding_gap"]) == -12000 and ran["feasible"]
    assert built.proposed_changes[0]["before"] == "10000.00" and built.proposed_changes[0]["after"] == "9000.00"


def test_spending_changes_refuse_bad_input():
    p = plan()
    for kwargs in (
        {"percent": D("5"), "amount": D("100")},
        {"percent": None, "amount": None},
        {"percent": D("0"), "amount": None},
        {"percent": D("101"), "amount": None},
        {"percent": None, "amount": D("10000.01")},
    ):
        with pytest.raises(adv.AdvisorInputError):
            adv.expense_change(p, categories=None, start_month=None, duration_months=12, **kwargs)
    with pytest.raises(adv.AdvisorInputError) as error:
        adv.expense_change(plan(expenses=(("Rent", "40000.00", True),)), percent=D("5"), amount=None, categories=None, start_month=None, duration_months=12)
    assert error.value.code == "no_eligible_spending"
    with pytest.raises(adv.AdvisorInputError):
        adv.expense_change(p, percent=D("5"), amount=None, categories=["Nothing like this"], start_month=None, duration_months=12)
    with pytest.raises(adv.AdvisorInputError):
        adv.expense_change(p, percent=D("5"), amount=None, categories=None, start_month="2026-01", duration_months=12)


def test_an_investment_is_a_transfer_not_new_spending_or_income():
    p = plan(goals=[{"id": "trip", "label": "Trip", "type": "custom", "target_amount_today": "100000.00", "target_date": "2027-12", "priority": 1, "inflation_linked": False, "current_savings": "0.00"}])
    lab = lab_for(p, cash="100000.00")
    base = adv.path_metrics(lab.run(), p)
    built = adv.investment_change(p, amount=D("5000"), frequency="monthly", start_month=None, duration_months=12, step_up_percent=D("0"))
    assert built.details["total_contributed"] == "60000.00"
    ran = adv.run_built(lab, p, built, base)
    # 60,000 left cash and became an investment (no return assumed): net worth is unchanged, cash is lower, goals are unaffected
    assert D(ran["deltas"]["horizon_net_worth"]) == 0 and D(ran["deltas"]["minimum_cash"]) < 0
    assert ran["feasible"] and ran["metrics"]["goals_achievable"] == base["goals_achievable"]


def test_an_investment_larger_than_cash_is_infeasible():
    p = plan(goals=[{"id": "trip", "label": "Trip", "type": "custom", "target_amount_today": "100000.00", "target_date": "2027-12", "priority": 1, "inflation_linked": False, "current_savings": "0.00"}])
    lab = lab_for(p, cash="10000.00")
    base = adv.path_metrics(lab.run(), p)
    ran = adv.run_built(lab, p, adv.investment_change(p, amount=D("5000000"), frequency="monthly", start_month=None, duration_months=6, step_up_percent=D("0")), base)
    assert ran["feasible"] is False and ran["violations"]


def test_a_step_up_raises_each_year_and_a_quarterly_schedule_skips_months():
    p = plan()
    stepped = adv.investment_change(p, amount=D("1000"), frequency="monthly", start_month=None, duration_months=24, step_up_percent=D("10"))
    amounts = [e.amount for e in stepped.planned_events]
    assert amounts[0] == D("1000.00") and amounts[11] == D("1000.00") and amounts[12] == D("1100.00") and sum(amounts) == D("12000.00") + D("13200.00")
    quarterly = adv.investment_change(p, amount=D("3000"), frequency="quarterly", start_month=None, duration_months=12, step_up_percent=D("0"))
    assert [e.month for e in quarterly.planned_events] == ["2027-01", "2027-04", "2027-07", "2027-10"]


def test_a_goal_change_does_not_touch_the_saved_goal():
    p = plan()
    before = p.model_dump()
    built = adv.goal_change(p, goal_id="trip", target_date="2031-12", target_amount_today=None)
    ran = adv.run_built(lab_for(p), p, built, adv.path_metrics(lab_for(p).run(), p))
    assert p.model_dump() == before and ran["metrics"]["goals"][0]["status"] == "achievable"
    with pytest.raises(adv.AdvisorInputError):
        adv.goal_change(p, goal_id="trip", target_date="2026-01", target_amount_today=None)
    with pytest.raises(adv.AdvisorInputError):
        adv.goal_change(p, goal_id="trip", target_date=None, target_amount_today=None)


def test_a_lower_return_assumption_is_a_validated_change_to_one_input():
    p = plan()
    built = adv.assumption_change(p, name="savings_return_annual", new_value=D("0.02"))
    assert built.scenario.assumption_overrides.savings_return_annual == D("0.02")
    with pytest.raises(adv.AdvisorInputError):
        adv.assumption_change(p, name="savings_return_annual", new_value=D("0.9"))
    with pytest.raises(adv.AdvisorInputError):
        adv.assumption_change(p, name="nonsense", new_value=D("0.02"))


def test_debt_extra_payments_are_checked_against_the_amortisation_engine():
    loan = LoanIn("L1", "Loan", "personal_loan", D("12000.00"), D("0"), D("1000.00"), 12)
    built = adv.debt_strategy([loan], D("50000"), loan_id="L1", extra=D("1000.00"), kind="monthly", start_month=None, duration_months=6, as_of="2027-01")
    d = built.details
    # no interest anywhere: 12 payments of 1,000 clear it in 12 months; paying 2,000 a month clears it in 6
    assert d["payoff_before"] == "2027-12" and d["payoff_after"] == "2027-06" and d["months_saved"] == 6
    assert D(d["interest_saved"]) == 0 and not built.violations and built.goal_effects_modelled is False
    interest_rate = LoanIn("L2", "Loan", "personal_loan", D("120000.00"), D("0.12"), D("12000.00"), 12)
    paid = adv.debt_strategy([interest_rate], D("50000"), loan_id="L2", extra=D("5000.00"), kind="monthly", start_month=None, duration_months=6, as_of="2027-01").details
    assert D(paid["interest_saved"]) > 0 and D(paid["interest_before"]) - D(paid["interest_after"]) == D(paid["interest_saved"])
    assert paid["payoff_after"] <= paid["payoff_before"]


def test_a_debt_payment_larger_than_the_surplus_is_infeasible_and_bad_loans_are_refused():
    loan = LoanIn("L1", "Loan", "personal_loan", D("12000.00"), D("0"), D("1000.00"), 12)
    assert adv.debt_strategy([loan], D("500"), loan_id="L1", extra=D("1000"), kind="monthly", start_month=None, duration_months=3, as_of="2027-01").violations
    with pytest.raises(adv.AdvisorInputError):
        adv.debt_strategy([loan], D("500"), loan_id="other", extra=D("1000"), kind="monthly", start_month=None, duration_months=3, as_of="2027-01")
    with pytest.raises(adv.AdvisorInputError):
        adv.debt_strategy([LoanIn("L3", "No payment", "personal_loan", D("1000"), D("0.1"), D("0"), 12)], None, loan_id="L3", extra=D("100"), kind="monthly", start_month=None, duration_months=3, as_of="2027-01")


def metrics(achievable, statuses, uncovered=0, gap="0.00", cash="1000.00"):
    return {
        "monthly_surplus": "100.00", "minimum_cash": cash, "minimum_cash_month": "2027-01", "uncovered_cash_months": uncovered, "horizon_net_worth": "1000.00", "horizon_net_worth_real": None,
        "goals_achievable": achievable, "goals_total": len(statuses), "total_funding_gap": gap, "debt_free": [],
        "goals": [{"goal_id": k, "label": k.upper(), "status": v, "target_date": "2027-12", "projected_completion": None, "funding_gap": "0.00"} for k, v in statuses.items()],
    }


def test_feasibility_rejects_cash_shortfalls_and_collateral_damage():
    base = metrics(2, {"a": "achievable", "b": "achievable"})
    assert adv.violations_for("simulate_expense_change", None, base, metrics(2, {"a": "achievable", "b": "achievable"})) == []
    assert adv.violations_for("x", None, base, metrics(2, {"a": "achievable", "b": "achievable"}, uncovered=2))
    assert adv.violations_for("x", None, base, metrics(2, {"a": "achievable", "b": "achievable"}, cash="-5.00"))
    hurt = metrics(1, {"a": "achievable", "b": "underfunded"})
    assert adv.violations_for("simulate_investment_change", None, base, hurt)
    assert adv.violations_for("simulate_goal_change", "b", base, hurt) == []  # the goal being moved may get worse; others may not


def test_the_comparison_reports_only_what_changed():
    base = metrics(1, {"a": "achievable", "b": "underfunded"}, gap="100.00")
    better = metrics(2, {"a": "achievable", "b": "achievable"}, gap="0.00")
    delta = adv.compare_metrics(base, better)
    assert delta["goals_achievable"] == 1 and D(delta["total_funding_gap"]) == -100
    assert [(c["goal_id"], c["status_before"], c["status_after"]) for c in delta["goal_changes"]] == [("b", "underfunded", "achievable")]


# --- checking what the model says ---------------------------------------------------------------------------------------


def test_ids_the_model_writes_into_prose_are_dropped_and_do_not_count_as_figures():
    from app.ai.advisor import clean

    text = clean("It closes the gap (scenario 8edb3c3a-3ede-4aec-b630-d92c6e0d56e1). Done.", 300)
    assert text == "It closes the gap. Done."
    assert unsupported_figures(clean("see 4d3584b3-9781-4b39-9f6c-914365c6ce92", 100), set()) == []


def test_figures_are_checked_against_what_was_calculated():
    allowed = figures_in('{"a": "52000.00", "b": "7"}')
    assert unsupported_figures("You would save ₹52,000 a month over 12 months by 2031.", allowed) == []
    assert unsupported_figures("That is 53,000.", allowed) == [Decimal(53000)]
    assert unsupported_figures("About 5.2 lakh.", allowed) == []  # a small number is a count, not an amount
