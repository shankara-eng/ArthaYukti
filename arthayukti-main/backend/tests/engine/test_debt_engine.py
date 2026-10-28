from decimal import Decimal

from fastapi.testclient import TestClient

from app.engine.debt import (
    calculate_amortization_schedule,
    calculate_emi,
    compare_payoff_strategies,
)
from app.main import app
from tests.helpers import authed_client


def test_calculate_emi_formula():
    # ₹10,00,000 at 10% annual rate for 120 months (10 years)
    p = Decimal("1000000.00")
    r = Decimal("0.10")
    n = 120
    emi = calculate_emi(p, r, n)
    # Standard formula P * r * (1+r)^n / ((1+r)^n - 1) gives ~13,215.07
    assert Decimal("13210.00") < emi < Decimal("13220.00")


def test_amortization_schedule_baseline_and_prepayment():
    # ₹5,00,000 at 12% annual rate for 36 months without extra payment
    base = calculate_amortization_schedule(
        principal=Decimal("500000.00"),
        annual_rate=Decimal("0.12"),
        tenure_months=36,
        extra_monthly_payment=Decimal("0.00"),
    )
    assert base["effective_months"] == 36
    assert base["months_saved"] == 0
    assert Decimal(base["total_interest_paid"]) > Decimal("90000.00")
    assert Decimal(base["interest_saved"]) == Decimal("0.00")

    # With ₹5,000 extra monthly prepayment
    accelerated = calculate_amortization_schedule(
        principal=Decimal("500000.00"),
        annual_rate=Decimal("0.12"),
        tenure_months=36,
        extra_monthly_payment=Decimal("5000.00"),
    )
    assert accelerated["effective_months"] < 36
    assert accelerated["months_saved"] > 0
    assert Decimal(accelerated["interest_saved"]) > Decimal("10000.00")
    assert Decimal(accelerated["total_interest_paid"]) < Decimal(base["total_interest_paid"])


def test_compare_payoff_strategies_avalanche_vs_snowball():
    debts = [
        # Debt 1: Credit Card - high rate, low balance
        {"id": "d1", "name": "Credit Card", "balance": Decimal("50000.00"), "interest_rate": Decimal("0.36"), "monthly_emi": Decimal("3000.00")},
        # Debt 2: Personal Loan - medium rate, medium balance
        {"id": "d2", "name": "Personal Loan", "balance": Decimal("200000.00"), "interest_rate": Decimal("0.15"), "monthly_emi": Decimal("6000.00")},
        # Debt 3: Auto Loan - low rate, high balance
        {"id": "d3", "name": "Car Loan", "balance": Decimal("400000.00"), "interest_rate": Decimal("0.09"), "monthly_emi": Decimal("10000.00")},
    ]

    res = compare_payoff_strategies(debts, extra_monthly_budget=Decimal("5000.00"))

    avalanche_interest = Decimal(res["avalanche"]["total_interest_paid"])
    snowball_interest = Decimal(res["snowball"]["total_interest_paid"])

    # Avalanche (highest rate first) must mathematically pay <= interest than Snowball
    assert avalanche_interest <= snowball_interest
    assert res["avalanche"]["months_to_debt_free"] <= res["snowball"]["months_to_debt_free"]
    assert "Avalanche" in res["recommendation"] or "Snowball" in res["recommendation"]


def test_debt_api_endpoints():
    client = TestClient(app)

    # 1. Public amortize endpoint
    r = client.post(
        "/api/v1/debt/amortize",
        json={
            "principal": "300000.00",
            "annual_interest_rate": "0.10",
            "tenure_months": 24,
            "extra_monthly_payment": "2000.00",
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert data["effective_months"] < 24
    assert len(data["schedule"]) == data["effective_months"]

    # 2. Compare strategies endpoint for authenticated user
    auth_c = authed_client("alice")

    # Add 2 liabilities
    auth_c.post(
        "/api/v1/financials/liabilities",
        json={
            "liability_name": "Credit Card",
            "liability_type": "credit_card",
            "principal_amount": "80000.00",
            "current_balance": "80000.00",
            "interest_rate": "0.24",
            "monthly_emi": "4000.00",
            "remaining_months": 24,
        },
    )
    auth_c.post(
        "/api/v1/financials/liabilities",
        json={
            "liability_name": "Personal Loan",
            "liability_type": "personal_loan",
            "principal_amount": "150000.00",
            "current_balance": "150000.00",
            "interest_rate": "0.14",
            "monthly_emi": "5000.00",
            "remaining_months": 36,
        },
    )

    # GET /debt/strategies pulls stored liabilities
    r = auth_c.get("/api/v1/debt/strategies?extra_budget=3000.00")
    assert r.status_code == 200
    strat = r.json()
    assert strat["avalanche"]["months_to_debt_free"] > 0
    assert strat["snowball"]["months_to_debt_free"] > 0
    assert len(strat["avalanche"]["payoff_order"]) == 2
