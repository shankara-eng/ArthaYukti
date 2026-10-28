from decimal import Decimal

from tests.helpers import authed_client


def test_household_profile_lifecycle_and_risk_capacity():
    c = authed_client("alice")

    # 1. Nothing has been provided yet: nothing is assumed
    r = c.get("/api/v1/household/profile")
    assert r.status_code == 200
    prof = r.json()
    assert prof["is_saved"] is False
    assert prof["id"] is None
    assert prof["primary_earner_age"] is None
    assert prof["household_type"] is None
    assert prof["dependants_count"] is None

    # 2. Update profile with family context
    update_payload = {
        "primary_earner_age": 34,
        "household_type": "dual_earner",
        "dependants_count": 2,
        "children_count": 1,
        "elderly_dependants_count": 1,
        "monthly_family_support": "15000.00",
        "job_stability": "high",
        "emergency_fund_months_target": 6,
        "dependants_details": [
            {
                "name": "Aarav",
                "relationship": "child",
                "age": 4,
                "annual_support_cost": "120000.00",
                "notes": "Preschool tuition and medical",
            },
            {
                "name": "Kamla",
                "relationship": "parent",
                "age": 68,
                "annual_support_cost": "180000.00",
                "notes": "Mother pension supplement and medical",
            },
        ],
        "planned_events": [
            {
                "event_name": "Second Child",
                "years_ahead": 2,
                "estimated_lump_sum_cost": "200000.00",
                "ongoing_monthly_cost": "10000.00",
            }
        ],
    }
    r = c.put("/api/v1/household/profile", json=update_payload)
    assert r.status_code == 200
    updated = r.json()
    assert updated["primary_earner_age"] == 34
    assert updated["household_type"] == "dual_earner"
    assert len(updated["dependants_details"]) == 2
    assert len(updated["planned_events"]) == 1
    assert Decimal(updated["monthly_family_support"]) == Decimal("15000.00")

    # 3. Add liquid account and liability to test risk capacity
    c.post(
        "/api/v1/financials/accounts",
        json={
            "account_name": "Emergency Savings",
            "account_type": "savings",
            "balance": "300000.00",
            "is_liquid": True,
        },
    )
    c.post(
        "/api/v1/financials/liabilities",
        json={
            "liability_name": "Home Loan",
            "liability_type": "home_loan",
            "principal_amount": "4000000.00",
            "current_balance": "3800000.00",
            "interest_rate": "0.085",
            "monthly_emi": "35000.00",
            "remaining_months": 180,
        },
    )

    # 4. Check risk capacity evaluation
    r = c.get("/api/v1/household/risk-capacity")
    assert r.status_code == 200
    rc = r.json()
    # Monthly commitments = 35,000 (EMI) + 15,000 (family support) = 50,000
    assert Decimal(rc["monthly_commitments"]) == Decimal("50000.00")
    # Liquid reserves = 300,000
    assert Decimal(rc["liquid_reserves"]) == Decimal("300000.00")
    # Coverage = 300,000 / 50,000 = 6.0 months
    assert Decimal(rc["reserve_coverage_months"]) == Decimal("6.0")
    assert rc["risk_capacity_level"] in ("High", "Moderate", "Low")
    assert len(rc["explanation"]) >= 4


def test_household_profile_tenant_isolation():
    c1 = authed_client("alice")
    c2 = authed_client("bob")

    c1.put("/api/v1/household/profile", json={"primary_earner_age": 42})
    c2.put("/api/v1/household/profile", json={"primary_earner_age": 28})

    p1 = c1.get("/api/v1/household/profile").json()
    p2 = c2.get("/api/v1/household/profile").json()

    assert p1["primary_earner_age"] == 42
    assert p2["primary_earner_age"] == 28
    assert p1["id"] != p2["id"]


def test_an_empty_profile_is_not_filled_with_invented_values():
    from sqlalchemy import func

    from app.db.models import HouseholdProfile
    from app.db.session import SessionLocal

    c = authed_client("carol")
    before = SessionLocal().query(func.count(HouseholdProfile.id)).scalar()
    prof = c.get("/api/v1/household/profile").json()
    assert prof["is_saved"] is False
    for key in ("primary_earner_age", "household_type", "dependants_count", "children_count", "monthly_family_support", "job_stability", "emergency_fund_months_target"):
        assert prof[key] is None, key
    # Reading does not create a row.
    assert SessionLocal().query(func.count(HouseholdProfile.id)).scalar() == before

    rc = c.get("/api/v1/household/risk-capacity").json()
    assert rc["risk_capacity_level"] == "Not assessed"
    assert rc["primary_earner_age"] is None and rc["household_type"] is None
    assert not any("Age 30" in line or "Single-earner" in line for line in rc["explanation"])


def test_a_partial_profile_is_assessed_only_on_what_was_provided():
    c = authed_client("dave")
    saved = c.put("/api/v1/household/profile", json={"primary_earner_age": 41}).json()
    assert saved["is_saved"] is True
    assert saved["primary_earner_age"] == 41
    # Fields not sent stay unknown; they do not take a default.
    assert saved["household_type"] is None
    assert saved["dependants_count"] is None
    assert saved["job_stability"] is None
    assert saved["emergency_fund_months_target"] is None

    rc = c.get("/api/v1/household/risk-capacity").json()
    text = " ".join(rc["explanation"])
    assert "Age 41" in text
    assert "Household type was not provided" in text
    assert "Dependants were not provided" in text
    assert "Job stability was not provided" in text
    assert "No reserve target was set" in text
    assert rc["household_type"] is None and rc["dependants_count"] is None

