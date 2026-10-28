import copy

from tests.api.test_api import sample_plan
from tests.helpers import authed_client

client = authed_client()


def test_saved_plans_crud_lifecycle():
    # 1. Create a plan
    plan_data = sample_plan()
    create_res = client.post("/api/v1/plans", json=plan_data)
    assert create_res.status_code == 201
    record = create_res.json()
    assert "id" in record
    plan_id = record["id"]
    assert record["plan"]["name"] == plan_data["name"]

    # 2. List plans
    list_res = client.get("/api/v1/plans")
    assert list_res.status_code == 200
    summaries = list_res.json()
    assert any(s["id"] == plan_id for s in summaries)

    # 3. Get plan by ID
    get_res = client.get(f"/api/v1/plans/{plan_id}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == plan_id

    # 4. Update plan
    updated_plan = copy.deepcopy(plan_data)
    updated_plan["name"] = "Updated Family Plan Name"
    put_res = client.put(f"/api/v1/plans/{plan_id}", json=updated_plan)
    assert put_res.status_code == 200
    assert put_res.json()["plan"]["name"] == "Updated Family Plan Name"

    # 5. Non-existent plan returns 404
    missing_res = client.get("/api/v1/plans/non_existent_id")
    assert missing_res.status_code == 404
