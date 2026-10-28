import copy
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.engine.helpers import SAMPLES
from tests.helpers import authed_client

client = TestClient(app)


def sample_plan() -> dict:
    return json.loads((SAMPLES / "tiny_delayed_goal.json").read_text(encoding="utf-8"))["plan"]


def test_health():
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_samples_are_listed():
    response = client.get("/api/v1/samples")
    assert response.status_code == 200
    ids = {item["id"] for item in response.json()}
    assert {"household", "tiny_delayed_goal", "family_stretched"} <= ids


def test_sample_detail_returns_a_valid_plan_with_string_amounts():
    response = client.get("/api/v1/samples/household")
    assert response.status_code == 200
    body = response.json()
    assert len(body["plan"]["goals"]) == 4
    assert body["plan"]["income_streams"][0]["monthly_net"] == "120000.00"
    assert len(body["scenarios"]) == 2


def test_stretched_family_sample_has_more_dreams_than_money():
    body = client.get("/api/v1/samples/family_stretched").json()
    assert [goal["id"] for goal in body["plan"]["goals"]] == ["emergency", "education", "home"]
    result = client.post("/api/v1/projections", json={"plan": body["plan"]}).json()
    assert result["summary"]["overcommitment_ratio"] == "1.6389"
    late = {g["goal_id"]: g["delay_months"] for g in result["goals"] if g["status"] != "on_track"}
    assert late == {"home": 5}


def test_unknown_sample_uses_the_error_shape():
    response = client.get("/api/v1/samples/does_not_exist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_sample_ids_cannot_escape_the_samples_folder():
    response = client.get("/api/v1/samples/..%2F..%2Fopenapi")
    assert response.status_code == 404


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("post", "/api/v1/projections", {"plan": None}),
        ("post", "/api/v1/tradeoffs", {"plan": None}),
        ("post", "/api/v1/fixes", {"plan": None}),
        ("post", "/api/v1/compare", {"plan": None, "scenarios": []}),
        ("post", "/api/v1/plans", {}),
    ],
)
def test_invalid_bodies_get_the_validation_error_shape(method, path, body):
    caller = authed_client() if path.endswith("/plans") else client
    response = getattr(caller, method)(path, json=body)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["details"]
    assert all({"loc", "msg"} <= set(detail) for detail in error["details"])


def test_tradeoffs_endpoint_returns_valid_tradeoff_matrix():
    response = client.post("/api/v1/tradeoffs", json={"plan": sample_plan()})
    assert response.status_code == 200
    body = response.json()
    assert "baseline" in body
    assert "rows" in body
    assert len(body["rows"]) == len(sample_plan()["goals"])
    assert body["rows"][0]["prioritised_goal_id"] == "home_deposit"


def test_fixes_returns_verified_options_for_the_delayed_goal():
    response = client.post("/api/v1/fixes", json={"plan": sample_plan()})
    assert response.status_code == 200
    body = response.json()
    assert body["needs_fix"] is True
    assert body["recommended_option_id"] == "delay_goal:home_deposit"
    levers = {option["lever"]: option for option in body["options"]}
    assert levers["extra_savings"]["magnitude"] == "10000.00"
    assert levers["extra_savings"]["scenario_delta"]["extra_monthly_savings"] == "10000.00"


def test_fixes_says_so_when_nothing_needs_fixing():
    scenario = {"name": "Save more", "extra_monthly_savings": "10000.00"}
    response = client.post("/api/v1/fixes", json={"plan": sample_plan(), "scenario": scenario})
    assert response.status_code == 200
    assert response.json()["needs_fix"] is False


def test_fixes_reports_an_inconsistent_scenario_as_422():
    scenario = {"name": "Bad", "priority_order": ["ghost"]}
    response = client.post("/api/v1/fixes", json={"plan": sample_plan(), "scenario": scenario})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "scenario_invalid"


def test_compare_shows_the_difference_between_scenarios():
    scenarios = [
        {"name": "As is"},
        {"name": "Save more", "extra_monthly_savings": "10000.00"},
    ]
    response = client.post("/api/v1/compare", json={"plan": sample_plan(), "scenarios": scenarios})
    assert response.status_code == 200
    body = response.json()
    assert [entry["scenario_name"] for entry in body["results"]] == ["As is", "Save more"]
    assert body["diffs"][0]["completion_shift_months"] == -4
    assert body["diffs"][0]["shortfall_change_today"] == "-120000.00"


def test_compare_needs_two_to_three_scenarios():
    response = client.post(
        "/api/v1/compare", json={"plan": sample_plan(), "scenarios": [{"name": "Only one"}]}
    )
    assert response.status_code == 422


def test_projection_returns_the_hand_checked_result():
    response = client.post("/api/v1/projections", json={"plan": sample_plan()})
    assert response.status_code == 200
    body = response.json()
    goal = body["goals"][0]
    assert goal["status"] == "delayed"
    assert goal["delay_months"] == 4
    assert goal["projected_completion"] == "2028-02"
    assert goal["shortfall_at_deadline_nominal"] == "120000.00"
    assert goal["required_monthly_level_standalone"] == "40000.00"
    assert body["summary"]["plan_feasible"] is False
    assert len(body["monthly"]) == body["horizon_months"]


def test_projection_can_leave_out_the_monthly_rows():
    response = client.post(
        "/api/v1/projections", json={"plan": sample_plan(), "include_monthly": False}
    )
    assert response.status_code == 200
    assert response.json()["monthly"] == []


def test_projection_applies_a_scenario():
    scenario = {"name": "Save more", "extra_monthly_savings": "10000.00"}
    response = client.post(
        "/api/v1/projections", json={"plan": sample_plan(), "scenario": scenario}
    )
    assert response.status_code == 200
    assert response.json()["summary"]["plan_feasible"] is True


def test_projection_reports_an_inconsistent_scenario_as_422():
    scenario = {"name": "Bad", "priority_order": ["ghost"]}
    response = client.post(
        "/api/v1/projections", json={"plan": sample_plan(), "scenario": scenario}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "scenario_invalid"


def test_projection_for_the_bundled_household_runs():
    household = client.get("/api/v1/samples/household").json()
    response = client.post(
        "/api/v1/projections",
        json={"plan": household["plan"], "scenario": household["scenarios"][0]},
    )
    assert response.status_code == 200
    assert response.json()["summary"]["goals_total"] == 4


def test_json_numbers_are_rejected_for_money():
    plan = copy.deepcopy(sample_plan())
    plan["income_streams"][0]["monthly_net"] = 90000
    response = client.post("/api/v1/projections", json={"plan": plan})
    assert response.status_code == 422
    assert "decimal string" in json.dumps(response.json())


def test_cors_allows_the_dev_frontend():
    response = client.get("/api/v1/health", headers={"Origin": "http://localhost:5173"})
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
