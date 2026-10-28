from decimal import Decimal

from tests.helpers import authed_client


def test_profile_personal_details_and_children():
    c = authed_client("alice")

    # Update personal details, account name, phone, children, parents, housing, employment
    update_payload = {
        "full_name": "Alice Sharma",
        "phone_number": "+91 9876543210",
        "primary_earner_age": 36,
        "marital_status": "married",
        "has_children": True,
        "children_ages": [5, 8, 12],
        "supports_mother": "yes",
        "supports_father": "no",
        "housing_status": "own_house",
        "employment_status": "salaried",
        "expected_retirement_age": 60,
        "financial_dependants": "three",
        "debt_types": ["home_loan", "vehicle_loan"],
        "emergency_fund_coverage": "3_to_6",
        "income_predictability": "very_predictable",
        "health_insurance_status": "yes",
        "life_insurance_status": "yes",
    }
    r = c.put("/api/v1/household/profile", json=update_payload)
    assert r.status_code == 200
    data = r.json()
    assert data["is_saved"] is True
    assert data["full_name"] == "Alice Sharma"
    assert data["phone_number"] == "+91 9876543210"
    assert data["primary_earner_age"] == 36
    assert data["marital_status"] == "married"
    assert data["has_children"] is True
    assert data["children_ages"] == [5, 8, 12]
    assert data["children_count"] == 3
    assert data["supports_mother"] == "yes"
    assert data["supports_father"] == "no"
    assert data["housing_status"] == "own_house"
    assert data["employment_status"] == "salaried"
    assert data["expected_retirement_age"] == 60
    assert data["financial_dependants"] == "three"
    assert sorted(data["debt_types"]) == ["home_loan", "vehicle_loan"]
    assert data["emergency_fund_coverage"] == "3_to_6"
    assert data["income_predictability"] == "very_predictable"
    assert data["health_insurance_status"] == "yes"
    assert data["life_insurance_status"] == "yes"

    # Get profile persists and retrieves all values
    g = c.get("/api/v1/household/profile")
    assert g.status_code == 200
    retrieved = g.json()
    assert retrieved["full_name"] == "Alice Sharma"
    assert retrieved["phone_number"] == "+91 9876543210"
    assert retrieved["children_ages"] == [5, 8, 12]


def test_mutually_incompatible_debt_types_rejected():
    c = authed_client("alice_debts")

    # Cannot select 'no_debt' with 'home_loan'
    r = c.put(
        "/api/v1/household/profile",
        json={"debt_types": ["no_debt", "home_loan"]},
    )
    assert r.status_code == 422
    assert "No outstanding debt" in r.text


def test_invalid_child_age_rejected():
    c = authed_client("alice_child")
    r = c.put(
        "/api/v1/household/profile",
        json={"children_ages": [-1, 10]},
    )
    assert r.status_code == 422


def test_guided_risk_assessment_scoring_and_history():
    c = authed_client("bob")

    # 1. Conservative responses
    r1 = c.post(
        "/api/v1/risk/assessment",
        json={
            "loss_reaction": "sell_all",
            "safety_growth": "protect",
            "time_horizon": "short",
        },
    )
    assert r1.status_code == 200
    res1 = r1.json()
    assert res1["tolerance_score"] == 3
    assert res1["risk_tolerance"] == "Conservative"
    assert res1["scoring_version"] == "v1.0"
    assert len(res1["explanations"]) == 3
    assert len(res1["limitations"]) > 0

    # 2. Check latest assessment
    latest = c.get("/api/v1/risk/assessment/latest").json()
    assert latest["id"] == res1["id"]
    assert latest["risk_tolerance"] == "Conservative"

    # 3. Retake assessment with Aggressive responses: does NOT overwrite previous, creates new record
    r2 = c.post(
        "/api/v1/risk/assessment",
        json={
            "loss_reaction": "invest_more",
            "safety_growth": "grow",
            "time_horizon": "long",
        },
    )
    assert r2.status_code == 200
    res2 = r2.json()
    assert res2["tolerance_score"] == 11
    assert res2["risk_tolerance"] == "Aggressive"
    assert res2["id"] != res1["id"]

    # 4. Check history returns both assessments in descending order
    history = c.get("/api/v1/risk/assessment/history").json()
    assert len(history) == 2
    assert history[0]["id"] == res2["id"]
    assert history[1]["id"] == res1["id"]
    assert history[0]["risk_tolerance"] == "Aggressive"
    assert history[1]["risk_tolerance"] == "Conservative"


def test_risk_capacity_conflict_detection():
    c = authed_client("conflict_user")

    # Save profile with low capacity indicators: 4 dependants, variable income, no emergency fund
    c.put(
        "/api/v1/household/profile",
        json={
            "primary_earner_age": 58,
            "financial_dependants": "four_or_more",
            "income_predictability": "varies_significantly",
            "health_insurance_status": "no",
        },
    )

    # User answers aggressive
    r = c.post(
        "/api/v1/risk/assessment",
        json={
            "loss_reaction": "invest_more",
            "safety_growth": "grow",
            "time_horizon": "long",
        },
    )
    assert r.status_code == 200
    res = r.json()
    assert res["risk_tolerance"] == "Aggressive"
    assert res["risk_capacity"] == "Low"
    assert res["conflict_note"] is not None
    assert "Conflict detected" in res["conflict_note"]
    # Composite stance is moderated from aggressive due to low capacity
    assert res["composite_stance"] in ("Moderate", "Conservative")


def test_recommendation_conservative_comparison():
    from tests.engine.helpers import load_sample_plan

    c = authed_client("carol_rec")
    sample_plan = load_sample_plan("household")
    sample_plan = sample_plan.model_copy(
        update={"assumptions": sample_plan.assumptions.model_copy(update={"savings_return_annual": Decimal("0.08")})}
    )

    payload = {
        "plan": sample_plan.model_dump(mode="json"),
        "conservative_return_drop": "0.025",
    }
    r = c.post("/api/v1/recommendations/conservative-comparison", json=payload)
    assert r.status_code == 200
    comp = r.json()

    assert comp["original"]["name"] == "original"
    assert comp["conservative"]["name"] == "conservative"
    assert comp["original"]["recommended_reserve_months"] == 6
    assert comp["conservative"]["recommended_reserve_months"] == 12

    # Return is lower in conservative variant
    orig_ret = Decimal(comp["original"]["assumed_annual_return"])
    cons_ret = Decimal(comp["conservative"]["assumed_annual_return"])
    assert cons_ret < orig_ret

    # Required monthly savings increase under lower return rate
    orig_monthly = Decimal(comp["original"]["total_monthly_required"])
    cons_monthly = Decimal(comp["conservative"]["total_monthly_required"])
    assert cons_monthly >= orig_monthly

    # Differences section is populated
    assert Decimal(comp["differences"]["annual_return_drop"]) == Decimal("0.025")
    assert len(comp["differences"]["delay_impacts"]) > 0
    assert "conservative variant models a lower annual return" in comp["differences"]["summary_explanation"]


def test_tenant_isolation_for_profile_and_risk():
    c_alice = authed_client("alice_tenant")
    c_bob = authed_client("bob_tenant")

    # Alice sets profile and assessment
    c_alice.put("/api/v1/household/profile", json={"full_name": "Alice Tenant", "primary_earner_age": 30})
    c_alice.post(
        "/api/v1/risk/assessment",
        json={"loss_reaction": "hold", "safety_growth": "balance", "time_horizon": "medium"},
    ).json()

    # Bob should not see Alice's profile or assessment
    bob_prof = c_bob.get("/api/v1/household/profile").json()
    assert bob_prof["is_saved"] is False
    assert bob_prof["full_name"] != "Alice Tenant"

    # Bob's latest assessment is 404
    r_bob = c_bob.get("/api/v1/risk/assessment/latest")
    assert r_bob.status_code == 404

    # Bob's history is empty
    bob_hist = c_bob.get("/api/v1/risk/assessment/history").json()
    assert len(bob_hist) == 0


# ---- independent review regressions -------------------------------------------------------


def _plan(c, return_rate="0.000000"):
    plan = c.get("/api/v1/samples/family_stretched").json()["plan"]
    plan["assumptions"]["savings_return_annual"] = return_rate
    return plan


def test_profile_rejects_inconsistent_children_and_bad_phone():
    c = authed_client("rv1")
    put = lambda body: c.put("/api/v1/household/profile", json=body).status_code  # noqa: E731
    assert put({"has_children": False, "children_ages": [4]}) == 422
    assert put({"has_children": True, "children_ages": []}) == 422
    assert put({"phone_number": "<script>1</script>"}) == 422
    assert put({"debt_types": ["multiple", "home_loan"]}) == 422
    assert put({"debt_types": ["no_debt", "home_loan"]}) == 422
    assert put({"children_ages": list(range(16))}) == 422
    assert put({"has_children": True, "children_ages": [3, 7], "phone_number": "+91 98765-43210", "debt_types": ["home_loan", "home_loan"]}) == 200
    prof = c.get("/api/v1/household/profile").json()
    assert prof["children_ages"] == [3, 7] and prof["debt_types"] == ["home_loan"]
    # Saying No clears stale ages instead of keeping them.
    c.put("/api/v1/household/profile", json={"has_children": False})
    prof = c.get("/api/v1/household/profile").json()
    assert prof["children_ages"] == [] and prof["children_count"] == 0
    # An empty phone clears it; phone never touches login.
    c.put("/api/v1/household/profile", json={"phone_number": ""})
    assert c.get("/api/v1/household/profile").json()["phone_number"] in (None, "")


def test_conservative_comparison_uses_the_saved_plan_and_rejects_ambiguous_input():
    c = authed_client("rv2")
    other = authed_client("rv3")
    plan = _plan(c, "0.080000")
    plan_id = c.post("/api/v1/plans", json=plan).json()["id"]
    both = c.post("/api/v1/recommendations/conservative-comparison", json={"plan_id": plan_id, "plan": plan})
    neither = c.post("/api/v1/recommendations/conservative-comparison", json={})
    assert both.status_code == 422 and neither.status_code == 422
    # Another user's plan id is indistinguishable from a missing one.
    assert other.post("/api/v1/recommendations/conservative-comparison", json={"plan_id": plan_id}).status_code == 404
    saved = c.post("/api/v1/recommendations/conservative-comparison", json={"plan_id": plan_id}).json()
    hypothetical = c.post("/api/v1/recommendations/conservative-comparison", json={"plan": plan}).json()
    assert saved["plan_source"] == "saved" and hypothetical["plan_source"] == "hypothetical"
    assert saved["original"] == hypothetical["original"]
    # A return drop that would make the plan less conservative or absurdly large is refused.
    for drop in ("-0.05", "0.5"):
        assert c.post("/api/v1/recommendations/conservative-comparison", json={"plan": plan, "conservative_return_drop": drop}).status_code == 422
    # Nothing was written back to the saved plan.
    assert c.get(f"/api/v1/plans/{plan_id}").json()["plan"]["assumptions"]["savings_return_annual"] == "0.080000"


def test_conservative_is_recalculated_and_honest_when_there_is_no_return_to_lower():
    from decimal import Decimal

    c = authed_client("rv4")
    with_return = c.post("/api/v1/recommendations/conservative-comparison", json={"plan": _plan(c, "0.080000")}).json()
    assert with_return["conservative"]["assumed_annual_return"] == "0.055000"
    assert Decimal(with_return["conservative"]["total_monthly_required"]) >= Decimal(with_return["original"]["total_monthly_required"])
    assert Decimal(with_return["differences"]["monthly_savings_increase"]) == max(
        Decimal("0"), Decimal(with_return["conservative"]["total_monthly_required"]) - Decimal(with_return["original"]["total_monthly_required"])
    )
    no_return = c.post("/api/v1/recommendations/conservative-comparison", json={"plan": _plan(c, "0.000000")}).json()
    assert no_return["original"]["goals"] == no_return["conservative"]["goals"]
    assert any("assumes no investment return" in n for n in no_return["notes"])
    assert not any("maintain current feasibility" in line for line in no_return["differences"]["delay_impacts"])


def test_risk_assessment_rejects_unknown_answers_and_keeps_history():
    c = authed_client("rv5")
    assert c.post("/api/v1/risk/assessment", json={"loss_reaction": "panic", "safety_growth": "grow", "time_horizon": "long"}).status_code == 422
    assert c.post("/api/v1/risk/assessment", json={"loss_reaction": "hold"}).status_code == 422
    first = c.post("/api/v1/risk/assessment", json={"loss_reaction": "sell_all", "safety_growth": "protect", "time_horizon": "short"}).json()
    second = c.post("/api/v1/risk/assessment", json={"loss_reaction": "invest_more", "safety_growth": "grow", "time_horizon": "long"}).json()
    assert (first["tolerance_score"], first["risk_tolerance"]) == (3, "Conservative")
    assert (second["tolerance_score"], second["risk_tolerance"]) == (11, "Aggressive")
    assert first["risk_capacity"] == "Not assessed" and "Not assessed" not in first["risk_tolerance"]
    history = c.get("/api/v1/risk/assessment/history").json()
    assert [h["id"] for h in history] == [second["id"], first["id"]]
    assert all(h["scoring_version"] == "v1.0" for h in history)
    assert other_cannot_see(history)


def other_cannot_see(history):
    other = authed_client("rv6")
    return other.get("/api/v1/risk/assessment/history").json() == [] and len(history) == 2


def test_deleting_the_account_removes_assessments_and_profile():
    from app.db.models import HouseholdProfile, RiskAssessment
    from app.db.session import SessionLocal

    c = authed_client("rv7")
    c.put("/api/v1/household/profile", json={"primary_earner_age": 40, "phone_number": "+91 98765 43210"})
    c.post("/api/v1/risk/assessment", json={"loss_reaction": "hold", "safety_growth": "balance", "time_horizon": "medium"})
    me = c.get("/api/v1/auth/me").json()["id"]
    db = SessionLocal()
    assert db.query(RiskAssessment).filter(RiskAssessment.user_id == me).count() == 1
    assert c.delete("/api/v1/auth/delete-account").status_code == 200
    db.expire_all()
    assert db.query(RiskAssessment).filter(RiskAssessment.user_id == me).count() == 0
    assert db.query(HouseholdProfile).filter(HouseholdProfile.user_id == me).count() == 0
    # Phone number is not a login identifier.
    assert c.post("/api/v1/auth/login", json={"email": "+91 98765 43210", "password": "x" * 12}).status_code in (401, 422)


def test_employment_other_can_be_described_only_while_the_status_is_other():
    c = authed_client("carol")
    refused = c.put("/api/v1/household/profile", json={"employment_status": "salaried", "employment_other": "Freelance"})
    assert refused.status_code == 422 and refused.json()["error"]["code"] == "employment_other_not_applicable"
    ok = c.put("/api/v1/household/profile", json={"employment_status": "other", "employment_other": "  Seasonal farm work  "})
    assert ok.status_code == 200 and ok.json()["employment_other"] == "Seasonal farm work"
    assert c.put("/api/v1/household/profile", json={"employment_other": "x" * 101}).status_code == 422
    changed = c.put("/api/v1/household/profile", json={"employment_status": "salaried"})
    assert changed.json()["employment_other"] is None  # the detail does not outlive "other"
    assert c.get("/api/v1/household/profile").json()["employment_other"] is None


def test_an_assessment_is_marked_when_the_profile_changes_after_it():
    c = authed_client("dave")
    c.put("/api/v1/household/profile", json={"employment_status": "salaried", "financial_dependants": "one"})
    answers = {"loss_reaction": "hold", "safety_growth": "balance", "time_horizon": "long"}
    first = c.post("/api/v1/risk/assessment", json=answers)
    assert first.status_code == 200 and first.json()["profile_changed_since"] is False
    assert c.get("/api/v1/risk/assessment/latest").json()["profile_changed_since"] is False
    c.put("/api/v1/household/profile", json={"financial_dependants": "three"})
    latest = c.get("/api/v1/risk/assessment/latest").json()
    assert latest["profile_changed_since"] is True
    assert latest["id"] == first.json()["id"] and latest["risk_tolerance"] == first.json()["risk_tolerance"]  # nothing rewritten
    c.post("/api/v1/risk/assessment", json=answers)  # retaking clears the mark
    assert c.get("/api/v1/risk/assessment/latest").json()["profile_changed_since"] is False
