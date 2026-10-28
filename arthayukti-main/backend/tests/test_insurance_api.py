from decimal import Decimal

from tests.helpers import authed_client

client = authed_client()


def test_insurance_policy_and_escalation_api_flow():
    # 1. Create a Term Life Policy
    policy_res = client.post(
        "/api/v1/insurance/policies",
        json={
            "policy_number": "POL-TERM-2026-999",
            "policy_type": "term_life",
            "insurer_name": "HDFC Life",
            "plan_name": "Click 2 Protect Super",
            "start_date": "2026-10-24",
            "renewal_date": "2027-10-24",
            "base_sum_assured": "10000000.00",
            "premium_amount": "22000.00",
            "premium_frequency": "annual",
            "status": "active",
        },
    )
    assert policy_res.status_code == 201
    policy_id = policy_res.json()["id"]

    # 2. Add an Escalation Schedule (10% simple increase per year, cap at 1.5 crore)
    esc_res = client.post(
        "/api/v1/insurance/escalations",
        json={
            "policy_id": policy_id,
            "escalation_type": "fixed_percentage",
            "escalation_rate": "0.100000",
            "escalation_frequency": "annual",
            "first_escalation_date": "2027-10-24",
            "maximum_total_cover": "15000000.00",
            "premium_increases_with_cover": True,
        },
    )
    assert esc_res.status_code == 201
    esc_id = esc_res.json()["id"]
    assert esc_res.json()["next_escalation_date"] == "2028-10-24"

    # 3. Process first escalation event
    event_res = client.post(
        f"/api/v1/insurance/escalations/{esc_id}/process-event",
        json={
            "event_type": "annual_step_up",
            "effective_date": "2027-10-24",
            "idempotency_key": f"key_{esc_id}_step1",
        },
    )
    assert event_res.status_code == 200
    ev = event_res.json()
    assert ev["prior_cover"] == "10000000.00"
    assert ev["resulting_cover"] == "11000000.00"
    assert ev["increase_amount"] == "1000000.00"

    # 4. Re-submitting the exact same idempotency_key must return the cached event without duplicate increase
    dup_res = client.post(
        f"/api/v1/insurance/escalations/{esc_id}/process-event",
        json={
            "event_type": "annual_step_up",
            "effective_date": "2027-10-24",
            "idempotency_key": f"key_{esc_id}_step1",
        },
    )
    assert dup_res.status_code == 200
    assert dup_res.json()["id"] == ev["id"]

    # 5. Check dashboard reflects the increased effective cover
    dash = client.get("/api/v1/insurance/dashboard").json()
    assert Decimal(dash["total_effective_cover"]) >= Decimal("11000000.00")
