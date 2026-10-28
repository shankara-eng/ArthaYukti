"""Income: the raise start year, the per-source breakdown, and saving income before any goal exists.

Expected figures are worked out by hand in the comment beside each. The running example is an income of 12,00,000 a year
with a 10% raise that starts in 2028.
"""

import json
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.engine.income import project_income_detail
from app.main import app
from app.schemas.plan import Plan
from tests.helpers import authed_client

D = Decimal
URL = "/api/v1/income/projection"
SAMPLE = json.loads((Path(__file__).resolve().parents[3] / "contracts/samples/family_stretched.json").read_text())["plan"]


def stream(id_="s1", **extra):
    base = {"id": id_, "label": id_.title(), "monthly_net": "0.00", "frequency": "yearly", "amount": "1200000.00", "start_year": 2027}
    return {**base, **extra}


def plan_with(streams, as_of="2027-01", goals=True, growth="0.000000"):
    plan = json.loads(json.dumps(SAMPLE))
    plan["as_of"] = as_of
    plan["income_streams"] = streams
    plan["expenses"], plan["commitments"] = [], []
    plan["assumptions"]["income_growth_annual"] = growth
    plan["goals"] = [{**plan["goals"][0], "id": "g1", "priority": 1, "target_date": "2032-12", "inflation_linked": False, "current_savings": "0.00"}] if goals else []
    return plan


def annual(streams, horizon=60, **kw):
    rows, sources = project_income_detail(Plan.model_validate(plan_with(streams, **kw)), horizon)
    return {r["year"]: r["annual_income"] for r in rows}, sources


def test_the_example_a_raise_that_starts_in_2028_repeats_every_year_after():
    years, _ = annual([stream(annual_growth="0.100000", growth_start_year=2028)])
    # 12,00,000 before the raise; 10% added from 2028 = 13,20,000; then it repeats: 14,52,000 in 2029.
    assert years[2027] == D("1200000.00") and years[2028] == D("1320000.00") and years[2029] == D("1452000.00")


def test_with_no_start_year_the_raise_is_first_added_the_year_after_the_income_starts():
    years, _ = annual([stream(annual_growth="0.100000")])
    assert years[2027] == D("1200000.00") and years[2028] == D("1320000.00")  # same as starting it in 2028


def test_a_later_raise_start_year_keeps_the_income_flat_until_then():
    years, _ = annual([stream(annual_growth="0.100000", growth_start_year=2029)])
    # Flat 12,00,000 in 2027 and 2028; the first raise lands in 2029 (13,20,000), then 14,52,000 in 2030.
    assert (years[2027], years[2028], years[2029], years[2030]) == (D("1200000.00"), D("1200000.00"), D("1320000.00"), D("1452000.00"))


def test_a_step_up_and_a_raise_in_the_same_year_are_applied_once_with_the_step_up_winning():
    years, _ = annual([stream(annual_growth="0.100000", growth_start_year=2028, step_ups=[{"id": "u1", "year": 2029, "amount": "1500000.00"}])])
    # 2028: 13,20,000 (raise). 2029 has both: the step-up replaces the amount (15,00,000), the raise is not added on top
    # (not 14,52,000 and not 16,50,000). 2030: the raise continues from the step-up: 16,50,000.
    assert years[2028] == D("1320000.00") and years[2029] == D("1500000.00") and years[2030] == D("1650000.00")


@pytest.mark.parametrize("frequency,amount", [("monthly", "100000.00"), ("quarterly", "300000.00"), ("yearly", "1200000.00")])
def test_every_frequency_normalises_to_the_same_annual_income(frequency, amount):
    years, _ = annual([stream(frequency=frequency, amount=amount)], 12)
    assert years[2027] == D("1200000.00")


def test_the_projection_period_sets_how_many_years_are_projected():
    streams = [stream(annual_growth="0.100000")]
    for months in (60, 120, 240):
        years, _ = annual(streams, months)
        assert len(years) == months // 12 and min(years) == 2027 and max(years) == 2027 + months // 12 - 1


def test_a_horizon_that_ends_mid_year_counts_only_the_months_inside_it():
    rows, _ = project_income_detail(Plan.model_validate(plan_with([stream(annual_growth="0.100000", growth_start_year=2028)], as_of="2027-07")), 18)
    assert [(r["year"], r["months_included"]) for r in rows] == [(2027, 6), (2028, 12)]
    assert rows[0]["annual_income"] == D("600000.00") and rows[1]["annual_income"] == D("1320000.00")  # 6 x 1,00,000; 12 x 1,10,000


def test_income_stops_after_its_end_year_and_a_legacy_stream_follows_the_plan_wide_growth():
    years, sources = annual([stream(end_year=2028)], 60)
    assert years[2028] == D("1200000.00") and years[2029] == D("0.00")  # the years stay listed, with nothing earned
    legacy = {"id": "old", "label": "Old", "monthly_net": "100000.00"}
    years, sources = annual([legacy], 24, growth="0.100000")
    assert years[2027] == D("1200000.00") and years[2028] == D("1320000.00")
    assert sources[0]["kind"] == "legacy" and sources[0]["effective_growth_annual"] == D("0.100000")


@pytest.mark.parametrize(
    "extra",
    [
        {"growth_start_year": 2028},  # a start year with no raise
        {"annual_growth": "0.100000", "growth_start_year": 2027},  # not after the income starts
        {"annual_growth": "0.100000", "growth_start_year": 2026},
        {"annual_growth": "0.100000", "growth_start_year": 2030, "end_year": 2029},  # after the income ends
    ],
)
def test_an_impossible_raise_start_is_refused(extra):
    with pytest.raises(ValueError):
        Plan.model_validate(plan_with([stream(**extra)]))


def test_an_income_with_no_start_year_cannot_carry_a_raise_start_year():
    with pytest.raises(ValueError):
        Plan.model_validate(plan_with([{"id": "old", "label": "Old", "monthly_net": "100.00", "growth_start_year": 2028}]))


# ---- the endpoint -----------------------------------------------------------------------------------------------


@pytest.fixture()
def client() -> TestClient:
    return authed_client("incomes")


def test_the_response_lists_each_source_and_its_years_and_they_add_up_to_the_totals(client):
    streams = [
        stream("salary", annual_growth="0.100000", growth_start_year=2028, step_ups=[{"id": "u", "year": 2030, "amount": "1800000.00"}]),
        stream("rent", frequency="monthly", amount="20000.00", start_year=2028, end_year=2031),
    ]
    body = client.post(URL, json={"plan": plan_with(streams), "horizon_months": 72}).json()
    assert [s["id"] for s in body["sources"]] == ["salary", "rent"]
    salary = body["sources"][0]
    assert (salary["entered_amount"], salary["monthly_equivalent"], salary["growth_start_year"], salary["effective_growth_annual"]) == ("1200000.00", "100000.00", 2028, "0.100000")
    assert salary["step_ups"] == [{"year": 2030, "amount": "1800000.00"}]
    for year in body["years"]:
        total = sum(D(y["amount"]) for source in body["sources"] for y in source["years"] if y["year"] == year["year"])
        assert total == D(year["annual_income"])  # per-source figures reconcile to the yearly total
    assert D(body["years"][-1]["cumulative_income"]) == D(body["total_projected_income"]) == sum(D(y["annual_income"]) for y in body["years"])
    assert len(body["years"]) == 6 and body["horizon_months"] == 72


def test_the_conventions_and_plan_growth_are_stated_with_the_numbers(client):
    body = client.post(URL, json={"plan": plan_with([stream()], growth="0.050000"), "horizon_months": 12}).json()
    assert body["plan_growth_annual"] == "0.050000"
    text = " ".join(body["conventions"])
    assert "annual totals" in text and "repeats every year" in text and "step-up" in text and "not added on top" in text


def test_the_csv_matches_the_json_for_the_same_projection(client):
    body = {"plan": plan_with([stream(annual_growth="0.100000", growth_start_year=2028)]), "horizon_months": 36}
    data = client.post(URL, json=body).json()
    text = client.post(URL + "/csv", json=body).content.decode("utf-8")
    rows = [r.split(",") for r in text.lstrip("﻿").strip().split("\r\n")]
    assert [r[1] for r in rows[1:]] == [y["annual_income"] for y in data["years"]]


# ---- income before any goal exists -------------------------------------------------------------------------------


def test_a_plan_with_income_and_no_goal_can_be_saved_and_projected(client):
    plan = plan_with([stream(annual_growth="0.100000", growth_start_year=2028)], goals=False)
    saved = client.post("/api/v1/plans", json=plan)
    assert saved.status_code == 201, saved.text
    body = client.post(URL, json={"plan_id": saved.json()["id"], "horizon_months": 36}).json()
    assert [y["annual_income"] for y in body["years"]] == ["1200000.00", "1320000.00", "1452000.00"]
    # And it can be edited and saved again without a goal.
    plan["income_streams"][0]["annual_growth"] = "0.050000"
    assert client.put(f"/api/v1/plans/{saved.json()['id']}", json=plan).status_code == 200


def test_goal_based_work_still_refuses_a_plan_with_no_goal(client):
    plan = plan_with([stream()], goals=False)
    assert client.post("/api/v1/projections", json={"plan": plan}).status_code == 422
    assert client.post("/api/v1/fixes", json={"plan": plan}).status_code == 422
    assert client.post("/api/v1/tradeoffs", json={"plan": plan}).status_code == 422
    assert client.post("/api/v1/rescue/analyze", json={"plan": plan}).status_code == 422
    saved = client.post("/api/v1/plans", json=plan).json()
    refused = client.post("/api/v1/recommendations/conservative-comparison", json={"plan_id": saved["id"]})
    assert refused.status_code == 422  # a saved goal-less plan is refused cleanly, not with a server error


def test_a_goal_less_plan_does_not_break_the_other_income_and_spending_views(client):
    plan = plan_with([stream()], goals=False)
    assert client.post("/api/v1/expenditure/projection", json={"plan": plan, "horizon_months": 12}).status_code == 200
    assert client.post("/api/v1/emergency-fund/analyze", json={"plan": plan}).status_code == 200


def test_another_persons_plan_is_not_found(client):
    saved = client.post("/api/v1/plans", json=plan_with([stream()])).json()
    assert authed_client("other-income").post(URL, json={"plan_id": saved["id"]}).status_code == 404
    assert TestClient(app).post(URL, json={"plan_id": saved["id"]}).status_code == 401
