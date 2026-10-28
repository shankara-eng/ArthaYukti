"""Hand-checked golden cases (docs/FINANCIAL_MODEL.md, section 12).

Written before the engine, then made to pass in M1.
"""

from decimal import Decimal

from app.engine.projection import inflated_target, monthly_surplus_series, project
from tests.engine.helpers import goal, load_sample_plan, make_plan


def D(value: str) -> Decimal:
    return Decimal(value)


def test_t1_inflation_adjustment():
    assert inflated_target(D("100000"), D("0.12"), 12) == D("112682.50")
    assert inflated_target(D("100000"), D("0"), 12) == D("100000.00")
    assert inflated_target(D("100000"), D("0.12"), 0) == D("100000.00")


def test_t2_monthly_surplus_with_ending_commitment():
    plan = make_plan(
        income="100000.00",
        expenses="60000.00",
        commitments=[
            {"id": "emi", "label": "EMI", "monthly_payment": "10000.00", "remaining_months": 3}
        ],
        goals=[goal("g", "100000.00", "2027-10", 1)],
    )
    assert monthly_surplus_series(plan, None, 5) == [
        D("30000.00"),
        D("30000.00"),
        D("30000.00"),
        D("40000.00"),
        D("40000.00"),
    ]


def test_t3_goal_completes_four_months_late():
    result = project(load_sample_plan("tiny_delayed_goal"))
    outcome = result.goals[0]
    assert outcome.status == "delayed"
    assert outcome.required_monthly_level_standalone == D("40000.00")
    assert outcome.balance_at_deadline == D("480000.00")
    assert outcome.shortfall_at_deadline_nominal == D("120000.00")
    assert outcome.projected_completion == "2028-02"
    assert outcome.delay_months == 4


def _two_goal_plan(priority_a: int, priority_b: int):
    return make_plan(
        income="50000.00",
        expenses="0.00",
        goals=[
            goal("a", "300000.00", "2027-04", priority_a),
            goal("b", "300000.00", "2027-10", priority_b),
        ],
    )


def test_t4_priority_order_decides_who_is_delayed():
    first = {g.goal_id: g for g in project(_two_goal_plan(1, 2)).goals}
    assert first["a"].status == "on_track"
    assert first["b"].status == "on_track"

    reversed_ = {g.goal_id: g for g in project(_two_goal_plan(2, 1)).goals}
    assert reversed_["a"].status == "delayed"
    assert reversed_["a"].delay_months == 6
    assert reversed_["a"].projected_completion == "2027-10"
    assert reversed_["b"].status == "on_track"
