"""The Financial Trajectory can read its spending from the Expenditure plans, and only when asked."""

from datetime import date
from decimal import Decimal

import pytest

from app.api import spending
from tests.api.test_trajectory_api import URL, plan_body
from tests.helpers import authed_client

D = Decimal


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch):
    monkeypatch.setattr(spending, "_today", lambda: date(2026, 10, 25))


def project(client, **extra):
    return client.post(URL, json={"plan": plan_body(income="0.00", expenses=[("Rent", "20000.00")], goals=False, as_of="2026-10"), "horizon": {"months": 12}, **extra})


def add_plan(client, **extra):
    body = {"category": "sys:housing", "amount": "5000.00", "frequency": "monthly", "duration": "today_forever", "inflation_override": "0.000000", **extra}
    response = client.post("/api/v1/expenditure/plans", json=body)
    assert response.status_code == 201, response.text


def test_the_default_still_uses_the_plans_own_expense_lines():
    client = authed_client("spend-default")
    add_plan(client)
    result = project(client).json()
    assert D(result["drivers"]["spending"]) == D("240000.00")  # 12 x 20,000 from the plan, untouched


def test_the_expenditure_plans_replace_the_plan_lines_when_chosen():
    client = authed_client("spend-source")
    add_plan(client)
    add_plan(client, category="sys:groceries", amount="1000.00")
    result = project(client, spending_source="expenditure_plans").json()
    assert D(result["drivers"]["spending"]) == D("72000.00")  # 12 x (5,000 + 1,000); the 20,000 plan line is not added on top
    assert any(w["code"] == "spending_from_expenditure_plans" for w in result["warnings"])


def test_it_follows_the_plans_own_inflation_and_scheduled_changes():
    client = authed_client("spend-infl")
    add_plan(client, inflation_override="0.100000")  # Oct-Dec 2026 at 5,000, then Jan-Sep 2027 at 5,500
    result = project(client, spending_source="expenditure_plans").json()
    assert D(result["drivers"]["spending"]) == D("64500.00")  # 3 x 5,000 + 9 x 5,500


def test_without_active_plans_it_refuses_instead_of_assuming_no_spending():
    client = authed_client("spend-none")
    response = project(client, spending_source="expenditure_plans")
    assert response.status_code == 422 and response.json()["error"]["code"] == "no_expenditure_plans"
    plan = client.post("/api/v1/expenditure/plans", json={"category": "sys:housing", "amount": "5000.00", "frequency": "monthly", "duration": "today_forever"}).json()
    client.post(f"/api/v1/expenditure/plans/{plan['id']}/stop")
    assert project(client, spending_source="expenditure_plans").status_code == 422


def test_it_reads_only_the_signed_in_persons_plans():
    owner, other = authed_client("spend-owner"), authed_client("spend-other")
    add_plan(owner)
    assert project(other, spending_source="expenditure_plans").status_code == 422


# ---- the goal engine and the plan-based endpoints -----------------------------------------------------------------------------------


def goal_plan(**extra):
    plan = plan_body(income="100000.00", expenses=[("Rent", "20000.00")], goals=True, as_of="2026-10")
    plan.update(extra)
    return plan


def test_a_spending_schedule_replaces_the_expense_lines_only_for_the_months_it_covers():
    from app.engine.projection import project
    from app.schemas.plan import Plan

    plan = Plan.model_validate(
        goal_plan(spending_schedule=[{"month": "2026-10", "amount": "5000.00"}, {"month": "2026-11", "amount": "6000.00"}])
    )
    months = project(plan, None, True).monthly
    assert [m.expenses for m in months[:3]] == [D("5000.00"), D("6000.00"), D("20000.00")]  # then the plan's own line again
    assert any(w.code == "spending_schedule_short" for w in project(plan, None, False).warnings)


def test_apply_to_plan_fills_the_schedule_from_the_expenditure_plans_and_the_goal_engine_reads_it():
    client = authed_client("spend-apply")
    add_plan(client)
    add_plan(client, category="sys:groceries", amount="1000.00")
    applied = client.post("/api/v1/expenditure/apply-to-plan", json={"plan": goal_plan(), "months": 24})
    assert applied.status_code == 200, applied.text
    schedule = applied.json()["spending_schedule"]
    assert len(schedule) == 24 and schedule[0] == {"month": "2026-10", "amount": "6000.00"} and schedule[-1]["month"] == "2028-09"
    result = client.post("/api/v1/projections", json={"plan": applied.json(), "include_monthly": True}).json()
    assert result["monthly"][0]["expenses"] == "6000.00" and result["monthly"][23]["expenses"] == "6000.00"
    plain = client.post("/api/v1/projections", json={"plan": goal_plan(), "include_monthly": True}).json()
    assert plain["monthly"][0]["expenses"] == "20000.00"  # without applying, nothing changes


def test_apply_to_plan_refuses_without_active_plans_and_for_a_bad_horizon():
    client = authed_client("spend-apply-none")
    assert client.post("/api/v1/expenditure/apply-to-plan", json={"plan": goal_plan()}).json()["error"]["code"] == "no_expenditure_plans"
    add_plan(client)
    assert client.post("/api/v1/expenditure/apply-to-plan", json={"plan": goal_plan(), "months": 601}).status_code == 422
    duplicate = goal_plan(spending_schedule=[{"month": "2026-10", "amount": "1.00"}, {"month": "2026-10", "amount": "2.00"}])
    assert client.post("/api/v1/projections", json={"plan": duplicate}).status_code == 422
