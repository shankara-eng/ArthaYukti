"""Conservative-comparison results checked against an independent month-by-month ledger.

The expected values below are computed here with plain Decimal arithmetic from the documented model
(docs/FINANCIAL_MODEL.md), not by calling the engine, so a wrong engine or a wrong endpoint fails.
"""

from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal

import pytest

from tests.helpers import authed_client

CENT = Decimal("0.01")
URL = "/api/v1/recommendations/conservative-comparison"


def q(x: Decimal) -> Decimal:
    return x.quantize(CENT, ROUND_HALF_UP)


def plan_for(c, surplus: str, target: str, months_to_deadline: int, annual_return: str, as_of="2027-01"):
    plan = c.get("/api/v1/samples/family_stretched").json()["plan"]
    year, month = (int(part) for part in as_of.split("-"))
    index = year * 12 + month - 1 + months_to_deadline - 1
    plan["as_of"] = as_of
    plan["income_streams"] = [{"id": "inc", "label": "Pay", "monthly_net": str(Decimal(surplus) + Decimal("10000.00")), "ends_after": None}]
    plan["expenses"] = [{"id": "exp", "label": "Living", "monthly": "10000.00", "essential": True}]
    plan["commitments"] = []
    plan["unassigned_savings"] = "0.00"
    plan["goals"] = [{
        "id": "g1", "label": "Goal", "type": "custom", "target_amount_today": target,
        "target_date": f"{index // 12}-{index % 12 + 1:02d}", "priority": 1, "inflation_linked": False,
        "inflation_rate_override": None, "current_savings": "0.00",
    }]
    plan["assumptions"] = {**plan["assumptions"], "savings_return_annual": annual_return, "general_inflation_annual": "0.000000", "income_growth_annual": "0.000000", "expense_growth_annual": "0.000000"}
    return plan


def post_ok(c, plan):
    r = c.post(URL, json={"plan": plan})
    assert r.status_code == 200, r.text[:600]
    return r.json()


def required_level(target: Decimal, months: int, annual_return: Decimal) -> Decimal:
    """Level monthly amount from month 1 (balance 0) that reaches `target` after `months` contributions."""
    r = annual_return / 12
    s = Decimal(months) if r == 0 else ((1 + r) ** months - 1) / r
    return (target / s).quantize(CENT, ROUND_CEILING)


def completion_month(surplus: Decimal, target: Decimal, annual_return: Decimal, horizon: int = 400) -> int:
    """First month t whose balance reaches the target: growth, then the contribution (capped at the need)."""
    r = annual_return / 12
    balance = Decimal("0.00")
    for t in range(1, horizon + 1):
        balance += q(balance * r)
        balance += min(surplus, max(Decimal("0.00"), target - balance))
        if balance >= target:
            return t
    raise AssertionError("never completes")


@pytest.mark.parametrize("annual_return", ["0.000000", "0.080000"])
def test_required_monthly_and_on_time_match_the_ledger(annual_return):
    c = authed_client("fx1")
    target, months = Decimal("100000.00"), 12
    plan = plan_for(c, "20000.00", "100000.00", months, annual_return)
    body = post_ok(c, plan)
    drop = Decimal("0.025")
    cons_return = max(Decimal(annual_return) - drop, Decimal("0"))

    for variant, rate in (("original", Decimal(annual_return)), ("conservative", cons_return)):
        goal = body[variant]["goals"][0]
        assert Decimal(goal["required_monthly_savings"]) == required_level(target, months, rate), variant
        assert goal["status"] == "on_track" and goal["delay_months"] == 0
        assert Decimal(body[variant]["assumed_annual_return"]) == rate
        assert Decimal(body[variant]["total_monthly_required"]) == required_level(target, months, rate)
    expected_increase = max(Decimal("0"), required_level(target, months, cons_return) - required_level(target, months, Decimal(annual_return)))
    assert Decimal(body["differences"]["monthly_savings_increase"]) == expected_increase


def test_zero_return_gives_identical_goals_and_the_exact_level_amount():
    c = authed_client("fx2")
    body = post_ok(c, plan_for(c, "20000.00", "100000.00", 12, "0.000000"))
    assert body["original"]["goals"][0]["required_monthly_savings"] == "8333.34"  # 100000 / 12, rounded up
    assert body["original"]["goals"] == body["conservative"]["goals"]
    assert Decimal(body["differences"]["monthly_savings_increase"]) == 0


@pytest.mark.parametrize("annual_return", ["0.000000", "0.080000"])
def test_delay_months_match_the_ledger_when_the_surplus_is_too_small(annual_return):
    c = authed_client("fx3")
    surplus, target, months = Decimal("5000.00"), Decimal("100000.00"), 12
    plan = plan_for(c, "5000.00", "100000.00", months, annual_return)
    body = post_ok(c, plan)
    cons_return = max(Decimal(annual_return) - Decimal("0.025"), Decimal("0"))
    for variant, rate in (("original", Decimal(annual_return)), ("conservative", cons_return)):
        goal = body[variant]["goals"][0]
        expected_delay = completion_month(surplus, target, rate) - months
        assert expected_delay > 0
        assert goal["status"] == "delayed", variant
        assert goal["delay_months"] == expected_delay, (variant, goal["delay_months"], expected_delay)
        # An infeasible goal is never reported as on time by the conservative version.
        assert body[variant]["on_track_count"] == 0


def test_invalid_or_missing_inputs_are_refused_not_defaulted():
    c = authed_client("fx4")
    good = plan_for(c, "20000.00", "100000.00", 12, "0.080000")
    past = {**good, "goals": [{**good["goals"][0], "target_date": "2026-01"}]}
    no_goals = {**good, "goals": []}
    bad_amount = {**good, "goals": [{**good["goals"][0], "target_amount_today": "0.00"}]}
    for bad in (past, no_goals, bad_amount):
        assert c.post(URL, json={"plan": bad}).status_code == 422
    assert c.post(URL, json={"plan": {"name": "x"}}).status_code == 422
