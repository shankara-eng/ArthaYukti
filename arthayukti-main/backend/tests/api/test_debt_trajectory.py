"""Debt trajectory: recorded debts run to payoff on the amortization engine, by calendar year, with the reasons for any
debt that cannot be shown. Figures are hand-checked against the standard EMI formula."""

from datetime import UTC, datetime
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.helpers import authed_client

D = Decimal
URL = "/api/v1/debt/trajectory"


@pytest.fixture()
def client() -> TestClient:
    return authed_client("debt")


def loan(client, name="Loan", balance="100000.00", rate="0.120000", emi="8884.88", months=12):
    response = client.post(
        "/api/v1/financials/liabilities",
        json={"liability_name": name, "liability_type": "personal_loan", "principal_amount": balance, "current_balance": balance, "interest_rate": rate, "monthly_emi": emi, "remaining_months": months},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_it_needs_a_sign_in():
    assert TestClient(app).get(URL).status_code == 401


def test_one_loan_matches_the_standard_emi_calculation_and_reconciles(client):
    loan(client)
    body = client.get(URL, params={"start_month": "2026-11"}).json()
    one = body["loans"][0]
    # 100,000 at 1% a month over 12 months: payment 8,884.88; the last payment clears the remainder.
    assert (one["status"], one["months_to_payoff"], one["debt_free_month"]) == ("ok", 12, "2027-10")
    assert (one["total_interest"], one["total_paid"]) == ("6618.53", "106618.53")
    years = {y["year"]: y for y in body["years"]}
    assert years[2026]["months_included"] == 2 and years[2027]["months_included"] == 10
    # Months 1 and 2: interest 1,000.00 and 921.15; principal 7,884.88 and 7,963.73; balance after month 2 is 84,151.39.
    assert (years[2026]["interest"], years[2026]["principal"], years[2026]["closing_balance"]) == ("1921.15", "15848.61", "84151.39")
    assert years[2027]["closing_balance"] == "0.00"
    # Everything borrowed is repaid, and payments are principal plus interest.
    assert sum(D(y["principal"]) for y in body["years"]) == D("100000.00")
    assert sum(D(y["payments"]) for y in body["years"]) == D(body["total_paid"])
    assert sum(D(y["interest"]) for y in body["years"]) == D(body["total_interest"])
    assert body["complete"] is True and body["debt_free_month"] == "2027-10"


def test_two_loans_are_summed_by_year_and_the_debt_free_month_is_the_last_one(client):
    loan(client, "Bank loan")
    loan(client, "Family loan", balance="50000.00", rate="0.000000", emi="5000.00", months=10)
    body = client.get(URL, params={"start_month": "2026-11"}).json()
    by_name = {row["name"]: row for row in body["loans"]}
    assert by_name["Family loan"]["debt_free_month"] == "2027-08" and by_name["Family loan"]["total_interest"] == "0.00"
    years = {y["year"]: y for y in body["years"]}
    # 2026 (two months): payments 2 x (8,884.88 + 5,000); interest 1,921.15 from the bank loan alone;
    # principal 15,848.61 + 10,000; balance 84,151.39 + 40,000.
    assert (years[2026]["payments"], years[2026]["interest"], years[2026]["principal"], years[2026]["closing_balance"]) == ("27769.76", "1921.15", "25848.61", "124151.39")
    assert sum(D(y["principal"]) for y in body["years"]) == D("150000.00")
    assert body["debt_free_month"] == "2027-10"


def test_a_debt_with_no_payment_or_one_below_the_interest_is_reported_not_guessed(client):
    loan(client, "Unpaid", emi="0.00")
    loan(client, "Too low", emi="500.00")
    loan(client, "Fine", balance="50000.00", rate="0.000000", emi="5000.00", months=10)
    body = client.get(URL, params={"start_month": "2026-11"}).json()
    by_name = {row["name"]: row for row in body["loans"]}
    assert by_name["Unpaid"]["status"] == "limited" and "No monthly payment" in by_name["Unpaid"]["reason"]
    assert by_name["Too low"]["status"] == "limited" and "does not cover the monthly interest" in by_name["Too low"]["reason"]
    assert by_name["Unpaid"]["total_interest"] is None and by_name["Unpaid"]["debt_free_month"] is None
    # The limited debts are left out of the totals and the result says it is incomplete.
    assert body["complete"] is False and body["debt_free_month"] is None
    assert sum(D(y["principal"]) for y in body["years"]) == D("50000.00")


def test_unknown_remaining_months_are_not_assumed_and_a_slow_payment_is_flagged(client):
    loan(client, "Unknown tenure", balance="50000.00", rate="0.000000", emi="5000.00", months=0)
    loan(client, "Slow", months=12, emi="8000.00")
    body = client.get(URL, params={"start_month": "2026-11"}).json()
    by_name = {row["name"]: row for row in body["loans"]}
    assert by_name["Unknown tenure"]["months_to_payoff"] == 10 and by_name["Unknown tenure"]["paid_later_than_recorded"] is False
    # 100,000 at 1% a month with 8,000 paid: n = -ln(1 - 1000/8000) / ln(1.01) = 13.4, so 14 payments, later than the 12 recorded.
    assert by_name["Slow"]["months_to_payoff"] == 14 and by_name["Slow"]["paid_later_than_recorded"] is True


def test_a_paid_off_debt_does_not_appear_and_no_debts_gives_an_empty_complete_answer(client):
    assert client.get(URL).json()["loans"] == [] and client.get(URL).json()["complete"] is True
    loan(client, "Cleared", balance="0.00", emi="0.00", months=0)
    assert client.get(URL).json()["loans"] == []


def test_only_your_own_debts_are_included(client):
    loan(client, "Mine")
    other = authed_client("other-debt")
    loan(other, "Theirs", balance="777.00", emi="100.00", months=9, rate="0.000000")
    names = [row["name"] for row in client.get(URL, params={"start_month": "2026-11"}).json()["loans"]]
    assert names == ["Mine"]


def test_the_start_month_defaults_to_this_month_and_must_be_valid(client):
    assert client.get(URL).json()["start_month"] == datetime.now(UTC).strftime("%Y-%m")
    assert client.get(URL, params={"start_month": "2026-13"}).status_code == 422
    assert client.get(URL, params={"start_month": "soon"}).status_code == 422


def test_the_trajectory_agrees_with_the_calculator_for_the_same_loan(client):
    loan(client)
    calculator = client.post("/api/v1/debt/amortize", json={"principal": "100000.00", "annual_interest_rate": "0.12", "tenure_months": 12, "monthly_emi": "8884.88"}).json()
    one = client.get(URL, params={"start_month": "2026-11"}).json()["loans"][0]
    assert one["total_interest"] == calculator["total_interest_paid"] and one["total_paid"] == calculator["total_amount_paid"]
    assert one["months_to_payoff"] == calculator["effective_months"]
