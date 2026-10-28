"""Planned spending: frequencies, bounded schedules, growth precedence, partial years, reconciliation, CSV, ownership.

Every expected figure is worked out by hand in the comment next to it.
"""

import json
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.engine.expenditure import project_expenditure
from app.engine.projection import project
from app.main import app
from app.schemas.plan import Plan
from tests.helpers import authed_client

D = Decimal
SAMPLE = json.loads((Path(__file__).resolve().parents[3] / "contracts/samples/family_stretched.json").read_text())["plan"]


def line(id_, monthly="0.00", **extra):
    return {"id": id_, "label": id_.title(), "monthly": monthly, "essential": True, **extra}


def plan_with(expenses, growth="0.000000", as_of="2027-01"):
    plan = json.loads(json.dumps(SAMPLE))
    plan["as_of"] = as_of
    plan["income_streams"] = [{"id": "s1", "label": "Salary", "monthly_net": "200000.00", "frequency": "monthly"}]
    plan["expenses"] = expenses
    plan["commitments"] = []
    plan["goals"] = [{**plan["goals"][0], "id": "g1", "priority": 1, "target_date": "2032-12", "inflation_linked": False, "current_savings": "0.00"}]
    plan["assumptions"]["expense_growth_annual"] = growth
    return plan


def years(plan, horizon=24):
    rows = project_expenditure(Plan.model_validate(plan), horizon)["years"]
    return {r["year"]: r for r in rows}  # type: ignore[index]


def test_a_plain_line_behaves_as_it_always_did():
    # 10,000 a month for 12 months = 120,000; the plan-wide 6% steps it to 10,600 from month 13.
    rows = years(plan_with([line("rent", "10000.00")], growth="0.060000"), 24)
    assert rows[2027]["annual_expenditure"] == D("120000.00")
    assert rows[2028]["annual_expenditure"] == D("127200.00")  # 12 x 10,600


@pytest.mark.parametrize(
    "frequency,amount,monthly",
    [("monthly", "10000.00", "10000.00"), ("quarterly", "30000.00", "10000.00"), ("yearly", "120000.00", "10000.00")],
)
def test_frequencies_are_spread_evenly_to_their_monthly_equivalent(frequency, amount, monthly):
    expense = line("x", "0.00", amount=amount, frequency=frequency, start_month="2027-01")
    parsed = Plan.model_validate(plan_with([expense]))
    assert parsed.expenses[0].monthly == D(monthly)  # the derived monthly equivalent replaces whatever was sent
    assert years(plan_with([expense]), 12)[2027]["annual_expenditure"] == D("120000.00")


def test_a_bounded_schedule_is_paid_only_between_its_months_inclusive():
    # 5,000 a month from March to May 2027 inclusive = 3 months = 15,000, and nothing after.
    expense = line("camp", "0.00", amount="5000.00", start_month="2027-03", end_month="2027-05")
    rows = years(plan_with([expense]), 24)
    assert rows[2027]["annual_expenditure"] == D("15000.00")
    assert rows[2028]["annual_expenditure"] == D("0.00")


def test_a_line_that_starts_later_is_not_counted_before_it_starts():
    expense = line("fees", "0.00", amount="2000.00", start_month="2027-07")
    rows = years(plan_with([expense]), 18)
    assert rows[2027]["annual_expenditure"] == D("12000.00")  # July to December = 6 months
    assert rows[2028]["annual_expenditure"] == D("12000.00")  # January to June (horizon ends) = 6 months


def test_a_line_has_its_own_growth_or_follows_the_plan_wide_rate():
    own = line("own", "0.00", amount="10000.00", start_month="2027-01", annual_growth="0.100000")
    plan_wide = line("wide", "0.00", amount="10000.00", start_month="2027-01")
    rows = years(plan_with([own, plan_wide], growth="0.060000"), 24)
    # Year one: 2 x 10,000 x 12 = 240,000. Year two: own 10% -> 11,000, plan-wide 6% -> 10,600, so 12 x 21,600.
    assert rows[2027]["annual_expenditure"] == D("240000.00")
    assert rows[2028]["annual_expenditure"] == D("259200.00")


def test_a_plain_line_can_take_its_own_growth_too():
    own = line("own", "10000.00", annual_growth="0.100000")
    assert years(plan_with([own], growth="0.000000"), 24)[2028]["annual_expenditure"] == D("132000.00")  # 12 x 11,000


def test_growth_steps_once_every_twelve_months_from_the_later_of_start_and_plan_start():
    # Starts July 2027 (plan month 7): the first step is 12 months later, July 2028 (plan month 19), not January 2028.
    late = line("late", "0.00", amount="1000.00", start_month="2027-07", annual_growth="0.200000")
    rows = years(plan_with([late]), 30)
    assert rows[2028]["annual_expenditure"] == D("13200.00")  # January-June 2028 at 1,000 = 6,000; July-December at 1,200 = 7,200
    assert rows[2029]["annual_expenditure"] == D("7200.00")  # January-June 2029 (horizon ends) at 1,200 = 6 x 1,200
    # A line that began before the plan starts steps 12 months after the PLAN starts, not after its own start.
    early = line("early", "0.00", amount="1000.00", start_month="2026-03", annual_growth="0.200000")
    rows = years(plan_with([early]), 24)
    assert rows[2027]["annual_expenditure"] == D("12000.00") and rows[2028]["annual_expenditure"] == D("14400.00")


def test_partial_years_only_count_the_months_inside_the_plan():
    # Plan starts November 2027, 4 months: November and December 2027, January and February 2028.
    rows = years(plan_with([line("rent", "10000.00")], as_of="2027-11"), 4)
    assert rows[2027]["months_included"] == 2 and rows[2027]["annual_expenditure"] == D("20000.00")
    assert rows[2028]["months_included"] == 2 and rows[2028]["annual_expenditure"] == D("20000.00")


def test_rounding_happens_once_per_month_half_up():
    # 100 a year spread = 8.3333... a month, rounded once to 8.33 each month: 12 x 8.33 = 99.96, not 100.00.
    expense = line("tiny", "0.00", amount="100.00", frequency="yearly", start_month="2027-01")
    assert years(plan_with([expense]), 12)[2027]["annual_expenditure"] == D("99.96")


def test_essential_and_discretionary_are_split_and_add_up():
    rows = years(plan_with([line("rent", "10000.00"), {**line("fun", "4000.00"), "essential": False}]), 12)
    assert rows[2027]["essential"] == D("120000.00") and rows[2027]["discretionary"] == D("48000.00")
    assert rows[2027]["essential"] + rows[2027]["discretionary"] == rows[2027]["annual_expenditure"]


def test_the_projection_reconciles_to_the_engines_monthly_spending_and_to_the_lines():
    expenses = [
        line("rent", "20000.00", annual_growth="0.050000"),
        line("school", "0.00", amount="90000.00", frequency="yearly", start_month="2027-04", end_month="2029-03"),
        {**line("fun", "0.00", amount="6000.00", frequency="quarterly", start_month="2027-02"), "essential": False},
    ]
    plan = plan_with(expenses, growth="0.060000")
    parsed = Plan.model_validate(plan)
    result = project(parsed, None, True)
    by_year: dict[int, Decimal] = {}
    for row in result.monthly:
        by_year[int(row.month[:4])] = by_year.get(int(row.month[:4]), D(0)) + row.expenses
    projection = project_expenditure(parsed, len(result.monthly))
    for r in projection["years"]:  # type: ignore[attr-defined]
        assert r["annual_expenditure"] == by_year[r["year"]]
        assert sum(ly["amount"] for line_ in projection["lines"] for ly in line_["years"] if ly["year"] == r["year"]) == r["annual_expenditure"]  # type: ignore[index]


@pytest.mark.parametrize(
    "extra",
    [
        {"amount": "100.00"},  # amount without a start month
        {"frequency": "yearly"},  # frequency without a start month
        {"end_month": "2028-01"},  # end without a start month
        {"amount": "100.00", "start_month": "2027-05", "end_month": "2027-04"},  # ends before it starts
        {"start_month": "2027-05"},  # scheduled without an amount
    ],
)
def test_invalid_schedules_are_refused(extra):
    with pytest.raises(ValueError):
        Plan.model_validate(plan_with([line("x", "0.00", **extra)]))


def test_the_old_plan_shape_and_unlimited_style_growth_bounds_still_validate():
    Plan.model_validate(plan_with([line("x", "100.00")]))
    with pytest.raises(ValueError):
        Plan.model_validate(plan_with([line("x", "100.00", annual_growth="0.500000")]))  # above the 30% bound


# ---- the endpoints ----------------------------------------------------------------------------------------------


@pytest.fixture()
def client() -> TestClient:
    return authed_client("spend")


def test_the_projection_needs_a_sign_in():
    assert TestClient(app).post("/api/v1/expenditure/projection", json={"plan": plan_with([line("rent", "1000.00")])}).status_code == 401


def test_the_api_projects_a_hypothetical_and_a_saved_plan(client):
    plan = plan_with([line("rent", "10000.00"), line("x", "0.00", amount="30000.00", frequency="quarterly", start_month="2027-01", end_month="2027-06")])
    hypothetical = client.post("/api/v1/expenditure/projection", json={"plan": plan, "horizon_months": 12}).json()
    assert hypothetical["plan_source"] == "hypothetical" and hypothetical["first_month"] == "2027-01"
    # Rent 120,000 + the quarterly line for 6 months at 10,000 a month = 60,000.
    assert hypothetical["years"][0]["annual_expenditure"] == "180000.00"
    assert hypothetical["total_projected_expenditure"] == "180000.00"
    saved = client.post("/api/v1/plans", json=plan).json()
    again = client.post("/api/v1/expenditure/projection", json={"plan_id": saved["id"], "horizon_months": 12}).json()
    assert again["plan_source"] == "saved" and again["years"] == hypothetical["years"]
    assert {line_["id"] for line_ in again["lines"]} == {"rent", "x"}


def test_another_persons_plan_is_not_found(client):
    saved = client.post("/api/v1/plans", json=plan_with([line("rent", "1000.00")])).json()
    other = authed_client("other")
    assert other.post("/api/v1/expenditure/projection", json={"plan_id": saved["id"]}).status_code == 404


def test_exactly_one_plan_source_is_required(client):
    assert client.post("/api/v1/expenditure/projection", json={}).status_code == 422
    plan = plan_with([line("rent", "1000.00")])
    assert client.post("/api/v1/expenditure/projection", json={"plan": plan, "plan_id": "x"}).status_code == 422


def test_the_csv_matches_the_screen_and_opens_in_excel(client):
    plan = plan_with([line("rent", "10000.00")], growth="0.060000")
    body = {"plan": plan, "horizon_months": 24}
    data = client.post("/api/v1/expenditure/projection", json=body).json()
    response = client.post("/api/v1/expenditure/projection/csv", json=body)
    assert response.status_code == 200 and response.headers["content-type"].startswith("text/csv")
    text = response.content.decode("utf-8")
    assert text.startswith("﻿")
    rows = [r.split(",") for r in text.lstrip("﻿").strip().split("\r\n")]
    assert rows[0][0] == "Year" and len(rows) == 1 + len(data["years"])
    for csv_row, year in zip(rows[1:], data["years"], strict=True):
        assert csv_row[0] == str(year["year"]) and csv_row[2] == year["annual_expenditure"] and csv_row[3] == year["cumulative_expenditure"]


def test_the_emergency_essentials_leave_out_lines_that_are_not_running_yet(client):
    plan = plan_with([line("rent", "30000.00"), line("later", "0.00", amount="10000.00", start_month="2027-06")])
    body = client.post("/api/v1/emergency-fund/analyze", json={"plan": plan, "target_months": 6}).json()
    assert body["monthly_essentials"] == "30000.00"  # the line that starts in June is not today's spending
