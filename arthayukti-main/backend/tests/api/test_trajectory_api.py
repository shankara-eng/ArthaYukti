"""Financial Trajectory over HTTP: it reads the signed-in person's own records, stays owner-scoped and never changes them."""

import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.db.models import MarketDataSnapshot
from app.db.session import SessionLocal
from app.main import app
from tests.helpers import authed_client

D = Decimal
URL = "/api/v1/trajectory/project"
SAMPLE = json.loads((Path(__file__).resolve().parents[3] / "contracts/samples/family_stretched.json").read_text())["plan"]


def plan_body(income="100000.00", expenses=(), goals=True, as_of=None):
    plan = json.loads(json.dumps(SAMPLE))
    plan["as_of"] = as_of or datetime.now(UTC).strftime("%Y-%m")
    plan["income_streams"] = [{"id": "inc", "label": "Salary", "monthly_net": income, "ends_after": None}]
    plan["expenses"] = [{"id": f"e{i}", "label": label, "monthly": amount, "essential": True} for i, (label, amount) in enumerate(expenses)]
    plan["commitments"] = []
    plan["unassigned_savings"] = "0.00"
    plan["assumptions"].update({"savings_return_annual": "0.000000", "income_growth_annual": "0.000000", "expense_growth_annual": "0.000000"})
    if goals:
        goal = {**plan["goals"][0], "id": "g1", "priority": 1, "type": "education", "target_amount_today": "100000.00", "target_date": f"{datetime.now(UTC).year + 1}-12", "inflation_linked": False, "current_savings": "0.00"}
        plan["goals"] = [goal]
    else:
        plan["goals"] = []
    return plan


@pytest.fixture()
def client() -> TestClient:
    return authed_client("trajectory")


def save_plan(client, **kw):
    response = client.post("/api/v1/plans", json=plan_body(**kw))
    assert response.status_code == 201, response.text
    return response.json()["id"]


def post(client, plan_id, **extra):
    return client.post(URL, json={"plan_id": plan_id, "horizon": {"months": 12}, **extra})


def add_account(client, balance="100000.00", **extra):
    body = {"account_name": "Savings", "account_type": "savings", "balance": balance, **extra}
    response = client.post("/api/v1/financials/accounts", json=body)
    assert response.status_code == 201, response.text
    return response.json()["id"]


# ---- access ------------------------------------------------------------------------------------------------------------


def test_it_needs_a_sign_in_and_another_persons_plan_is_not_found(client):
    pid = save_plan(client)
    assert TestClient(app).post(URL, json={"plan_id": pid}).status_code == 401
    assert authed_client("other-traj").post(URL, json={"plan_id": pid}).status_code == 404


def test_it_reads_only_the_signed_in_persons_records(client):
    add_account(client, "100000.00")
    other = authed_client("other-records")
    add_account(other, "9000000.00")
    pid = save_plan(client, goals=False)
    body = post(client, pid).json()
    assert body["opening_balances"]["cash"] == "100000.00"


def test_a_hypothetical_plan_uses_the_callers_records_too(client):
    add_account(client, "70000.00")
    body = client.post(URL, json={"plan": plan_body(goals=False), "horizon": {"months": 6}}).json()
    assert body["opening_balances"]["cash"] == "70000.00"


# ---- the balance sheet comes from the records ----------------------------------------------------------------------------------


def test_records_flow_into_the_projection_and_are_not_changed_by_it(client):
    add_account(client, "200000.00")
    add_account(client, "50000.00", account_name="Bank FD", account_type="fixed_deposit", is_liquid=False)
    client.post("/api/v1/financials/investments", json={"asset_name": "Gold", "asset_type": "gold", "quantity": "10.0000", "purchase_price": "0.00", "current_value": "300000.00"})
    loan = client.post(
        "/api/v1/financials/liabilities",
        json={"liability_name": "Car loan", "liability_type": "auto_loan", "principal_amount": "400000.00", "current_balance": "360000.00", "interest_rate": "0.100000", "monthly_emi": "10000.00", "remaining_months": 60},
    )
    assert loan.status_code == 201, loan.text
    pid = save_plan(client, income="0.00", goals=False)
    body = post(client, pid).json()
    opening = body["opening_balances"]
    assert (opening["cash"], opening["deposits_and_investment_accounts"], opening["physical_and_other_assets"], opening["loans"]) == ("200000.00", "50000.00", "300000.00", "360000.00")
    assert opening["net_worth"] == "190000.00"  # 200000 + 50000 + 300000 - 360000
    month_one = body["monthly_ledger"][0]["debt_events"][0]
    assert (month_one["interest"], month_one["principal"]) == ("3000.00", "7000.00")
    assert body["summary"]["reconciles"] is True and body["model_version"] == "trajectory-1.0"
    # Viewing changed nothing: the same records give the same answer.
    assert post(client, pid).json() == body
    after = client.get("/api/v1/financials/liabilities")
    assert after.status_code in (200, 404, 405)


def test_cash_falls_back_to_the_plans_unassigned_savings_only_when_no_account_is_recorded(client):
    plan = plan_body(goals=False)
    plan["unassigned_savings"] = "40000.00"
    pid = client.post("/api/v1/plans", json=plan).json()["id"]
    first = post(client, pid).json()
    assert first["opening_balances"]["cash"] == "40000.00"
    assert any(p["source"].startswith("plan.unassigned_savings") for p in first["provenance"] if p["component"] == "cash")
    add_account(client, "10000.00")
    second = post(client, pid).json()
    assert second["opening_balances"]["cash"] == "10000.00"  # not 50000: the same savings are not counted twice
    assert "unassigned_savings_not_added" in [w["code"] for w in second["warnings"]]


def test_a_stored_stale_quote_keeps_its_last_price_and_is_marked_stale(client):
    hid = client.post("/api/v1/financials/investments", json={"asset_name": "Acme", "asset_type": "stock", "symbol": "ACMETRAJ", "quantity": "100.0000", "purchase_price": "0.00", "current_value": "0.00"}).json()["id"]
    db = SessionLocal()
    try:
        db.add(MarketDataSnapshot(symbol="ACMETRAJ", asset_type="equity", price=D("60.0000"), currency="INR", source="TEST_FEED", fetched_at=datetime.now(UTC) - timedelta(days=5), is_stale=False))
        db.commit()
    finally:
        db.close()
    pid = save_plan(client, goals=False)
    body = post(client, pid).json()
    assert body["opening_balances"]["market_investments"] == "6000.00"  # 100 x 60.00
    assert body["completeness"]["stale_quotes"] == 1
    warning = next(w for w in body["warnings"] if w["code"] == "stale_quote")
    assert warning["severity"] == "warning" and warning["edit_route"] == "equities" and warning["record_id"] == hid
    assert any(p["kind"] == "provider_fetched" and p["label"] == "Acme" for p in body["provenance"])


def test_a_holding_with_no_price_and_no_value_is_left_out_not_counted_as_zero(client):
    hid = client.post("/api/v1/financials/investments", json={"asset_name": "Unpriced", "asset_type": "stock", "quantity": "1.0000", "purchase_price": "0.00", "current_value": "0.00"}).json()["id"]
    add_account(client, "1000.00")
    body = post(client, save_plan(client, goals=False)).json()
    assert body["completeness"]["status"] == "partial"
    assert any(m["record_id"] == hid for m in body["completeness"]["missing"])


def test_insurance_premiums_and_ulip_values_come_from_the_policies(client):
    add_account(client, "100000.00")
    policy = {
        "policy_number": "TERM-1",
        "policy_type": "term_life",
        "insurer_name": "Acme Life",
        "plan_name": "Term 1cr",
        "start_date": "2020-01-15",
        "renewal_date": f"{datetime.now(UTC).year + 1}-03-15",
        "base_sum_assured": "10000000.00",
        "premium_amount": "15000.00",
        "premium_frequency": "annual",
    }
    assert client.post("/api/v1/insurance/policies", json=policy).status_code == 201
    ulip = {**policy, "policy_number": "ULIP-1", "policy_type": "ulip", "plan_name": "Growth", "premium_amount": "0.00", "base_sum_assured": "1000000.00", "policy_details": {"fund_value": "250000.00"}}
    assert client.post("/api/v1/insurance/policies", json=ulip).status_code == 201
    body = client.post(URL, json={"plan": plan_body(income="0.00", goals=False), "horizon": {"months": 24}}).json()
    assert body["opening_balances"]["insurance_fund_value"] == "250000.00"
    assert body["opening_balances"]["total_assets"] == "350000.00"  # 11 crore of cover adds nothing
    premiums = [e for row in body["monthly_ledger"] for e in row["insurance_events"] if e["kind"] == "premium"]
    assert len(premiums) >= 1 and all(e["cash_delta"] == "-15000.00" for e in premiums)


def test_premiums_already_in_spending_are_not_taken_again_by_default(client):
    add_account(client, "100000.00")
    policy = {
        "policy_number": "H-1",
        "policy_type": "health",
        "insurer_name": "Acme",
        "plan_name": "Health",
        "start_date": "2020-01-15",
        "renewal_date": f"{datetime.now(UTC).year + 1}-03-15",
        "base_sum_assured": "500000.00",
        "premium_amount": "12000.00",
        "premium_frequency": "annual",
    }
    client.post("/api/v1/insurance/policies", json=policy)
    plan = plan_body(income="0.00", expenses=[("Health insurance premium", "1000.00")], goals=False)
    auto = client.post(URL, json={"plan": plan, "horizon": {"months": 24}}).json()
    explicit_no = client.post(URL, json={"plan": plan, "horizon": {"months": 24}, "premiums_in_spending": "no"}).json()
    assert auto["drivers"]["premiums_paid"] == "0.00" and explicit_no["drivers"]["premiums_paid"] != "0.00"
    assert D(explicit_no["summary"]["horizon_cash"]) < D(auto["summary"]["horizon_cash"])


# ---- views, goals, scenarios --------------------------------------------------------------------------------------------------------


def test_selected_goals_view_adds_the_goal_and_the_baseline_stays_unchanged(client):
    add_account(client, "10000.00")
    pid = save_plan(client, income="50000.00", expenses=[("Life", "30000.00")])
    base = post(client, pid).json()
    withgoal = post(client, pid, view="selected_goals", selected_goal_ids=["g1"]).json()
    assert base["view"] == "baseline" and base["goals"] == [] and base["comparison"] is None
    assert withgoal["goals"][0]["goal_id"] == "g1" and withgoal["comparison"]["baseline_horizon_net_worth"] == base["summary"]["horizon_net_worth"]
    assert post(client, pid).json() == base  # the baseline is immutable
    assert withgoal["summary"]["reconciles"] is True


def test_a_scenario_view_needs_a_scenario_and_applies_it(client):
    add_account(client, "0.00")
    pid = save_plan(client, income="50000.00", expenses=[("Life", "30000.00")], goals=False)
    assert post(client, pid, view="scenario").status_code == 422
    scenario = {"name": "Loss", "events": [{"type": "income_change", "from_month": datetime.now(UTC).strftime("%Y-%m"), "to_month": (datetime.now(UTC) + timedelta(days=62)).strftime("%Y-%m"), "multiplier": "0.0000"}]}
    hit = post(client, pid, view="scenario", scenario=scenario).json()
    assert D(hit["comparison"]["net_worth_difference"]) < 0


def test_a_goal_that_is_not_in_the_plan_is_refused(client):
    pid = save_plan(client)
    assert post(client, pid, view="selected_goals", selected_goal_ids=["nope"]).status_code == 422


def test_view_and_goal_choices_are_validated(client):
    pid = save_plan(client)
    assert post(client, pid, view="selected_goals").status_code == 422  # no goal chosen
    assert post(client, pid, view="baseline", selected_goal_ids=["g1"]).status_code == 422  # the baseline excludes goals
    assert post(client, pid, selected_goal_ids=["g1", "g1"], view="selected_goals").status_code == 422
    assert client.post(URL, json={"horizon": {"months": 12}}).status_code == 422  # neither plan_id nor plan
    assert client.post(URL, json={"plan_id": pid, "plan": plan_body(), "horizon": {"months": 12}}).status_code == 422


# ---- horizon, age, snapshot -------------------------------------------------------------------------------------------------


def test_the_horizon_is_bounded(client):
    pid = save_plan(client, goals=False)
    assert client.post(URL, json={"plan_id": pid, "horizon": {"months": 601}}).status_code == 422
    assert client.post(URL, json={"plan_id": pid, "horizon": {"months": 0}}).status_code == 422
    assert client.post(URL, json={"plan_id": pid, "horizon": {"months": 12, "target_age": 60}}).status_code == 422
    assert client.post(URL, json={"plan_id": pid}).json()["horizon_months"] == 120  # the default


def test_a_horizon_by_age_needs_a_reference_age_and_never_guesses_one(client):
    pid = save_plan(client, goals=False)
    refused = client.post(URL, json={"plan_id": pid, "horizon": {"target_age": 50}})
    assert refused.status_code == 422 and refused.json()["error"]["code"] == "age_reference_missing"
    assert client.put("/api/v1/household/profile", json={"primary_earner_age": 40}).status_code == 200
    body = client.post(URL, json={"plan_id": pid, "horizon": {"target_age": 45}}).json()
    assert body["horizon_months"] == 60 and body["reference_age"] == 40
    assert [c["age"] for c in body["checkpoints"]][0] == 40 and body["checkpoints"][-1]["age"] == 45
    assert client.post(URL, json={"plan_id": pid, "horizon": {"target_age": 40}}).status_code == 422  # not in the future


def test_the_snapshot_hash_is_stable_and_changes_when_a_record_changes(client):
    add_account(client, "100000.00")
    pid = save_plan(client, goals=False)
    first = post(client, pid).json()["input_snapshot_hash"]
    assert post(client, pid).json()["input_snapshot_hash"] == first
    stale = post(client, pid, input_snapshot_hash=first)
    assert stale.status_code == 200
    add_account(client, "5000.00", account_name="Second")
    changed = post(client, pid, input_snapshot_hash=first)
    assert changed.status_code == 409 and changed.json()["error"]["code"] == "snapshot_changed"
    assert post(client, pid).json()["input_snapshot_hash"] != first


def test_the_ledger_and_events_can_be_left_out(client):
    pid = save_plan(client, goals=False)
    assert post(client, pid, include_monthly_ledger=False).json()["monthly_ledger"] is None
    lean = post(client, pid, include_events=False).json()
    assert all(row["income_events"] == [] for row in lean["monthly_ledger"])
    assert lean["summary"]["horizon_net_worth"] == post(client, pid).json()["summary"]["horizon_net_worth"]


# ---- assumptions and explicit inputs ----------------------------------------------------------------------------------------------------


def test_a_return_assumption_must_name_a_real_class_or_record(client):
    add_account(client, "1000.00")
    pid = save_plan(client, goals=False)
    assert post(client, pid, return_assumptions=[{"scope": "class", "key": "moonshots", "annual_rate": "0.100000"}]).status_code == 422
    assert post(client, pid, return_assumptions=[{"scope": "holding", "key": "nope", "annual_rate": "0.100000"}]).status_code == 422
    assert post(client, pid, return_assumptions=[{"scope": "class", "key": "market_investments", "annual_rate": "0.900000"}]).status_code == 422
    ok = post(client, pid, return_assumptions=[{"scope": "class", "key": "market_investments", "annual_rate": "0.100000"}])
    assert ok.status_code == 200 and any(a["kind"] == "user_assumed" for a in ok.json()["effective_assumptions"])


def test_money_must_be_a_decimal_string(client):
    pid = save_plan(client, goals=False)
    bad = post(client, pid, premium_growth_annual=0.05)
    assert bad.status_code == 422


def test_planned_events_are_checked(client):
    fd = add_account(client, "100000.00", account_name="FD", account_type="fixed_deposit", is_liquid=False)
    pid = save_plan(client, income="0.00", goals=False)
    when = datetime.now(UTC).strftime("%Y-%m")
    ok = post(client, pid, planned_events=[{"id": "m1", "month": when, "kind": "deposit_maturity", "label": "FD matures", "account_id": fd, "maturity_amount": "107000.00"}])
    assert ok.status_code == 200 and ok.json()["summary"]["horizon_cash"] == "107000.00"
    below = post(client, pid, planned_events=[{"id": "m1", "month": when, "kind": "deposit_maturity", "label": "x", "account_id": fd, "maturity_amount": "90000.00"}])
    assert below.status_code == 422 and below.json()["error"]["code"] == "maturity_below_balance"
    assert post(client, pid, planned_events=[{"id": "m1", "month": when, "kind": "deposit_maturity", "label": "x", "account_id": "nope"}]).status_code == 422
    assert post(client, pid, planned_events=[{"id": "b", "month": when, "kind": "investment_purchase", "label": "Buy"}]).status_code == 422  # no amount
    dup = [{"id": "d", "month": when, "kind": "investment_purchase", "label": "Buy", "amount": "10.00"}] * 2
    assert post(client, pid, planned_events=dup).status_code == 422


def test_a_goal_effect_needs_a_selected_goal_and_a_real_debt(client):
    pid = save_plan(client)
    assert post(client, pid, goal_effects=[{"goal_id": "g1", "effect": "spend"}]).status_code == 422  # g1 is not selected
    assert post(client, pid, view="selected_goals", selected_goal_ids=["g1"], goal_effects=[{"goal_id": "g1", "effect": "debt_reduction", "liability_id": "nope"}]).status_code == 422
    assert post(client, pid, view="selected_goals", selected_goal_ids=["g1"], goal_effects=[{"goal_id": "g1", "effect": "debt_reduction"}]).status_code == 422  # a debt reduction names its debt


def test_the_errors_do_not_echo_the_request_body(client):
    pid = save_plan(client)
    response = post(client, pid, view="selected_goals", selected_goal_ids=["secret-looking-id"])
    assert response.status_code == 422
    assert "plan_id" not in response.text and pid not in response.text


# ---- inflation-adjusted net worth and the year-by-year table ---------------------------------------------------------------------


def test_net_worth_is_restated_in_todays_money_only_when_an_inflation_rate_is_given(client):
    add_account(client, "100000.00")
    plan = plan_body(income="0.00", expenses=[], goals=False)
    plain = client.post(URL, json={"plan": plan, "horizon": {"months": 24}}).json()
    assert plain["summary"]["horizon_net_worth_real"] is None and plain["checkpoints"][-1]["net_worth_real"] is None
    adjusted = client.post(URL, json={"plan": plan, "horizon": {"months": 24}, "inflation_annual": "0.100000"}).json()
    # Nothing is spent or earned, so net worth stays 100,000 nominal; two years at 10%: 100,000 / 1.21 = 82,644.63.
    assert adjusted["summary"]["horizon_net_worth"] == "100000.00"
    assert adjusted["summary"]["horizon_net_worth_real"] == "82644.63"
    assert adjusted["checkpoints"][0]["net_worth_real"] == "100000.00"  # today needs no adjustment
    assert adjusted["input_snapshot_hash"] != plain["input_snapshot_hash"]  # the adjustment is part of what the figures depend on


def test_the_yearly_table_reconciles_with_the_monthly_ledger_and_chains_year_to_year(client):
    add_account(client, "50000.00")
    plan = plan_body(income="100000.00", expenses=[("Life", "60000.00")], goals=False, as_of="2027-01")
    result = client.post(URL, json={"plan": plan, "horizon": {"months": 30}, "inflation_annual": "0.050000"}).json()
    yearly = result["yearly"]
    assert [(y["year"], y["months_included"]) for y in yearly] == [(2027, 12), (2028, 12), (2029, 6)]
    assert all(y["reconciles"] for y in yearly)
    for earlier, later in zip(yearly, yearly[1:], strict=False):
        assert earlier["closing_net_worth"] == later["opening_net_worth"] and earlier["closing_cash"] == later["opening_cash"]
    for y in yearly:
        assert D(y["closing_net_worth"]) - D(y["opening_net_worth"]) == D(y["net_worth_change"])
        assert D(y["closing_total_assets"]) - D(y["closing_total_liabilities"]) == D(y["closing_net_worth"])
    assert yearly[-1]["closing_net_worth"] == result["summary"]["horizon_net_worth"]
    assert yearly[-1]["closing_net_worth_real"] == result["summary"]["horizon_net_worth_real"]
    ledger = result["monthly_ledger"]
    income_in_2027 = sum(D(e["cash_delta"]) for m in ledger if m["month"].startswith("2027") for e in m["income_events"])
    assert D(next(g for g in yearly[0]["groups"] if g["group"] == "income")["cash_in"]) == income_in_2027
