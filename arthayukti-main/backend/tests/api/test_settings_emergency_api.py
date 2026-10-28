"""Default inflation preference, the emergency-fund analysis, and the debt calculator's boundary handling."""

import json
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.helpers import authed_client

D = Decimal
SAMPLE = json.loads((Path(__file__).resolve().parents[3] / "contracts/samples/family_stretched.json").read_text())["plan"]


@pytest.fixture()
def client() -> TestClient:
    return authed_client("settings")


# ---- default inflation ------------------------------------------------------------------------------------------


def test_preferences_need_a_sign_in():
    anonymous = TestClient(app)
    assert anonymous.get("/api/v1/auth/preferences").status_code == 401
    assert anonymous.put("/api/v1/auth/preferences", json={"default_inflation_annual": "0.05"}).status_code == 401


def test_a_new_account_shows_the_starting_value_labelled_as_such_then_keeps_the_persons_own(client):
    first = client.get("/api/v1/auth/preferences").json()
    assert first == {"default_inflation_annual": "0.050000", "is_default": True}
    saved = client.put("/api/v1/auth/preferences", json={"default_inflation_annual": "0.065"}).json()
    assert saved == {"default_inflation_annual": "0.065000", "is_default": False}
    assert client.get("/api/v1/auth/preferences").json() == saved


def test_zero_inflation_is_a_valid_choice_and_is_not_confused_with_unset(client):
    client.put("/api/v1/auth/preferences", json={"default_inflation_annual": "0"})
    assert client.get("/api/v1/auth/preferences").json() == {"default_inflation_annual": "0.000000", "is_default": False}


@pytest.mark.parametrize("value", ["-0.01", "0.31", "abc", 0.05, None])
def test_an_out_of_range_or_malformed_rate_is_refused_and_nothing_is_saved(client, value):
    assert client.put("/api/v1/auth/preferences", json={"default_inflation_annual": value}).status_code == 422
    assert client.get("/api/v1/auth/preferences").json()["is_default"] is True


def test_the_preference_belongs_to_one_account(client):
    client.put("/api/v1/auth/preferences", json={"default_inflation_annual": "0.08"})
    other = authed_client("other")
    assert other.get("/api/v1/auth/preferences").json() == {"default_inflation_annual": "0.050000", "is_default": True}


def test_changing_the_default_does_not_touch_saved_plans_or_calculations(client):
    saved = client.post("/api/v1/plans", json=SAMPLE).json()
    before = client.get(f"/api/v1/plans/{saved['id']}").json()["plan"]["assumptions"]
    client.put("/api/v1/auth/preferences", json={"default_inflation_annual": "0.12"})
    assert client.get(f"/api/v1/plans/{saved['id']}").json()["plan"]["assumptions"] == before


def test_the_default_is_in_the_data_export(client):
    assert client.get("/api/v1/auth/export-data").json()["user"]["default_inflation_annual"] is None
    client.put("/api/v1/auth/preferences", json={"default_inflation_annual": "0.07"})
    assert D(client.get("/api/v1/auth/export-data").json()["user"]["default_inflation_annual"]) == D("0.07")


# ---- emergency fund ---------------------------------------------------------------------------------------------


def plan_with_reserve(saved="120000.00", goal_target="300000.00"):
    plan = json.loads(json.dumps(SAMPLE))
    plan["expenses"] = [
        {"id": "e1", "label": "Living", "monthly": "30000.00", "essential": True},
        {"id": "e2", "label": "Fun", "monthly": "10000.00", "essential": False},
    ]
    plan["commitments"] = [{"id": "c1", "label": "Loan", "monthly_payment": "10000.00", "remaining_months": 24}]
    plan["income_streams"] = [{"id": "s1", "label": "Salary", "monthly_net": "100000.00", "frequency": "monthly"}]
    plan["goals"] = [
        {
            **plan["goals"][0],
            "id": "reserve",
            "label": "Emergency fund",
            "type": "emergency_fund",
            "target_amount_today": goal_target,
            "current_savings": saved,
            "priority": 1,
            "inflation_linked": False,
        }
    ]
    return plan


def analyze(client, plan, months=None):
    body = {"plan": plan}
    if months is not None:
        body["target_months"] = months
    return client.post("/api/v1/emergency-fund/analyze", json=body)


def test_the_emergency_analysis_needs_a_sign_in():
    assert TestClient(app).post("/api/v1/emergency-fund/analyze", json={"plan": plan_with_reserve()}).status_code == 401


def test_held_reserve_target_cover_and_shortfall_are_worked_out_from_the_plan(client):
    body = analyze(client, plan_with_reserve(), months=6).json()
    # Essentials = essential spending 30,000 + loan payment 10,000. Flexible spending is not essential.
    assert body["monthly_essentials"] == "40000.00"
    assert body["target_amount"] == "240000.00"
    assert body["reserve_held"] == "120000.00"
    assert body["months_covered"] == "3.0"
    assert body["progress"] == "0.5000"
    assert body["shortfall_to_target"] == "120000.00"
    assert body["has_goal"] is True and body["goal_id"] == "reserve"


def test_a_reserve_above_the_target_shows_no_shortfall_and_progress_is_capped(client):
    body = analyze(client, plan_with_reserve(saved="500000.00"), months=6).json()
    assert body["shortfall_to_target"] == "0.00" and body["progress"] == "1.0000"


def test_the_reserve_is_counted_once_and_bank_balances_are_never_added(client):
    client.post("/api/v1/financials/accounts", json={"account_name": "Savings", "account_type": "savings", "balance": "900000.00", "currency": "INR", "is_liquid": True})
    assert analyze(client, plan_with_reserve(), months=6).json()["reserve_held"] == "120000.00"


def test_the_projection_comes_from_the_engine_and_starts_at_the_held_balance_or_above(client):
    body = analyze(client, plan_with_reserve(), months=6).json()
    projected = body["projected"]
    assert 1 <= len(projected) <= 24
    first = D(projected[0]["balance"])
    assert first >= D("120000.00")
    assert [D(p["balance"]) for p in projected] == sorted(D(p["balance"]) for p in projected)
    assert body["goal_status"] in {"on_track", "delayed", "not_achievable"}


def test_without_a_target_or_a_goal_nothing_is_invented(client):
    plan = plan_with_reserve()
    plan["goals"][0]["type"] = "home"
    body = analyze(client, plan).json()
    assert body["has_goal"] is False
    assert body["reserve_held"] is None and body["target_amount"] is None and body["progress"] is None
    assert body["projected"] == [] and body["months_covered"] is None
    assert any("No emergency-fund goal" in note for note in body["notes"])
    no_target = analyze(client, plan_with_reserve()).json()
    assert no_target["target_amount"] is None and no_target["shortfall_to_target"] is None
    assert no_target["reserve_held"] == "120000.00"


def test_an_empty_spending_plan_gives_no_months_of_cover(client):
    plan = plan_with_reserve()
    plan["expenses"], plan["commitments"] = [], []
    body = analyze(client, plan, months=6).json()
    assert body["monthly_essentials"] == "0.00" and body["months_covered"] is None and body["progress"] is None


def test_before_any_goal_exists_the_spending_alone_gives_the_essentials(client):
    # A plan with no goals is not a valid plan, so a new account sends only its spending.
    body = client.post(
        "/api/v1/emergency-fund/analyze",
        json={
            "expenses": [{"id": "e1", "label": "Living", "monthly": "30000.00", "essential": True}],
            "commitments": [{"id": "c1", "label": "Loan", "monthly_payment": "10000.00", "remaining_months": 12}],
            "target_months": 6,
        },
    ).json()
    assert body["monthly_essentials"] == "40000.00" and body["target_amount"] == "240000.00"
    assert body["has_goal"] is False and body["reserve_held"] is None and body["projected"] == []


def test_a_completely_empty_request_is_answered_without_inventing_anything(client):
    body = client.post("/api/v1/emergency-fund/analyze", json={}).json()
    assert body["monthly_essentials"] == "0.00" and body["target_amount"] is None and body["reserve_held"] is None


@pytest.mark.parametrize("months", [0, 61, -1])
def test_a_target_outside_one_to_sixty_months_is_refused(client, months):
    assert analyze(client, plan_with_reserve(), months=months).status_code == 422


def test_plan_b_reserve_floor_checks_are_unaffected(client):
    """Plan B takes its floor from the person, not from this page: the evaluator result does not depend on it."""
    from tests.engine.test_recovery_eval import example

    before = client.post("/api/v1/recovery/evaluate", json=example(months=6, income_months=6)).json()
    client.put("/api/v1/auth/preferences", json={"default_inflation_annual": "0.2"})
    analyze(client, plan_with_reserve(), months=6)
    assert client.post("/api/v1/recovery/evaluate", json=example(months=6, income_months=6)).json() == before


# ---- debt calculator boundaries ---------------------------------------------------------------------------------

AMORTIZE = "/api/v1/debt/amortize"


def test_a_normal_loan_pays_off_with_the_emi_the_engine_works_out(client):
    body = client.post(AMORTIZE, json={"principal": "100000.00", "annual_interest_rate": "0.12", "tenure_months": 12}).json()
    assert body["monthly_emi"] == "8884.88" and body["effective_months"] == 12
    assert body["schedule"][-1]["remaining_balance"] == "0.00"


def test_extra_payments_save_months_and_interest(client):
    body = client.post(AMORTIZE, json={"principal": "100000.00", "annual_interest_rate": "0.12", "tenure_months": 12, "extra_monthly_payment": "5000.00"}).json()
    assert body["effective_months"] == 8 and body["months_saved"] == 4 and D(body["interest_saved"]) > 0


def test_a_zero_interest_loan_is_just_the_balance_over_the_tenure(client):
    body = client.post(AMORTIZE, json={"principal": "120000.00", "annual_interest_rate": "0", "tenure_months": 12}).json()
    assert body["monthly_emi"] == "10000.00" and body["total_interest_paid"] == "0.00"


def test_a_zero_balance_is_a_clear_input_error_not_a_server_error(client):
    response = client.post(AMORTIZE, json={"principal": "0", "annual_interest_rate": "0.1", "tenure_months": 12})
    assert response.status_code == 422 and response.json()["error"]["code"] == "debt_invalid"


def test_a_payment_below_the_monthly_interest_is_refused_with_a_reason(client):
    response = client.post(AMORTIZE, json={"principal": "100000.00", "annual_interest_rate": "0.12", "tenure_months": 12, "monthly_emi": "500.00"})
    assert response.status_code == 422 and response.json()["error"]["code"] == "payment_too_low"


@pytest.mark.parametrize("rate", ["-0.01", "0.31"])
def test_an_invalid_interest_rate_is_refused(client, rate):
    assert client.post(AMORTIZE, json={"principal": "100000.00", "annual_interest_rate": rate, "tenure_months": 12}).status_code == 422
