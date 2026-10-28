from decimal import Decimal

from fastapi.testclient import TestClient

from app.engine.investments import calculate_sip_projection
from app.main import app


def test_regular_sip_compounding():
    # ₹10,000 monthly for 5 years at 12% annual return
    res = calculate_sip_projection(
        monthly_investment=Decimal("10000.00"),
        annual_expected_return=Decimal("0.12"),
        tenure_years=5,
    )
    # Total invested over 60 months = 6,00,000
    assert Decimal(res["total_invested"]) == Decimal("600000.00")
    # Final wealth with 12% compounding is ~8.24 lakhs
    final_wealth = Decimal(res["final_wealth"])
    assert Decimal("800000.00") < final_wealth < Decimal("850000.00")
    assert Decimal(res["estimated_returns"]) == final_wealth - Decimal("600000.00")
    assert len(res["yearly_milestones"]) == 5


def test_step_up_sip_percentage():
    # ₹10,000 monthly with 10% annual step-up for 5 years at 12% return
    res = calculate_sip_projection(
        monthly_investment=Decimal("10000.00"),
        annual_expected_return=Decimal("0.12"),
        tenure_years=5,
        step_up_percentage=Decimal("0.10"),
    )
    # Monthly SIP increases each year: 10,000 -> 11,000 -> 12,100 -> 13,310 -> 14,641
    assert Decimal(res["starting_monthly_sip"]) == Decimal("10000.00")
    assert Decimal(res["final_monthly_sip"]) == Decimal("14641.00")
    # Total invested with step up > 6,00,000
    assert Decimal(res["total_invested"]) > Decimal("600000.00")
    # Wealth should be greater than flat SIP
    assert Decimal(res["final_wealth"]) > Decimal("900000.00")


def test_step_up_sip_fixed_amount():
    # ₹10,000 monthly with ₹1,000 annual fixed step-up for 3 years at 10% return
    res = calculate_sip_projection(
        monthly_investment=Decimal("10000.00"),
        annual_expected_return=Decimal("0.10"),
        tenure_years=3,
        step_up_amount=Decimal("1000.00"),
    )
    # Year 1: 10,000, Year 2: 11,000, Year 3: 12,000
    assert Decimal(res["final_monthly_sip"]) == Decimal("12000.00")
    assert len(res["yearly_milestones"]) == 3


def test_sip_calculator_api_endpoint():
    client = TestClient(app)

    r = client.post(
        "/api/v1/financials/investments/sip-calculator",
        json={
            "monthly_investment": "15000.00",
            "annual_expected_return": "0.14",
            "tenure_years": 10,
            "step_up_percentage": "0.10",
            "initial_investment": "50000.00",
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert Decimal(data["total_invested"]) > Decimal("1800000.00")
    assert Decimal(data["final_wealth"]) > Decimal(data["total_invested"])
    assert len(data["yearly_milestones"]) == 10
