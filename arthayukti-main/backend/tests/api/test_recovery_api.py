"""Plan B over HTTP: search, comparison, agreements, versions, review and ownership."""

import json
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.db.models import RecoveryAgreement, RecoveryAgreementVersion
from app.db.session import SessionLocal
from app.main import app
from tests.engine.test_recovery_eval import example
from tests.helpers import authed_client

D = Decimal
BASE = "/api/v1/recovery"


@pytest.fixture()
def client() -> TestClient:
    return authed_client("planb")


def search_body(**kw):
    return {
        "input": example(months=6, income_months=6, home_pause_max=12),
        "adjust_months": 6,
        **kw,
    }


def chosen_draft(client, **extra):
    """Run the search and turn its only option into a draft, as the page does."""
    result = client.post(f"{BASE}/search", json=search_body()).json()
    option = result["options"][0]
    data = example(months=6, income_months=6, home_pause_max=12)
    data["adjustments"] = [d["adjustment"] for d in option["adjustments"]]
    data["review_month"] = "2027-05"
    return {
        "input": data,
        "selected_label": option["label"],
        "rationale": "Keeps education and retirement going.",
        **extra,
    }


def save(client, name="Job gap", **kw):
    return client.post(
        f"{BASE}/agreements", json={"name": name, "draft": chosen_draft(client), **kw}
    )


# ---- auth and validation ----------------------------------------------------------------------------------------


def test_every_route_needs_a_signed_in_user():
    anon = TestClient(app)
    assert anon.post(f"{BASE}/search", json=search_body()).status_code == 401
    assert anon.post(f"{BASE}/evaluate", json=example()).status_code == 401
    assert anon.get(f"{BASE}/agreements").status_code == 401
    assert anon.post(f"{BASE}/agreements", json={}).status_code == 401


def test_the_search_endpoint_returns_the_worked_example(client):
    body = client.post(f"{BASE}/search", json=search_body()).json()
    assert body["search"]["status"] == "found" and body["search"]["complete"] is True
    [option] = body["options"]
    assert (
        option["evaluation"]["final_liquid"] == "180000.00"
        and option["metrics"]["floor_headroom"] == "0.00"
    )
    assert option["metrics"]["goal_contributions_deferred"] == "60000.00"
    assert body["ranking_policy"] and body["infeasibility"] is None


def test_an_impossible_request_is_reported_as_infeasible_with_the_strongest_plan(client):
    body = {"input": example(months=8, income_months=8, home_pause_max=12), "adjust_months": 8}
    out = client.post(f"{BASE}/search", json=body).json()
    assert out["search"]["status"] == "infeasible" and out["options"] == []
    assert out["infeasibility"]["shortfall"] == "40000.00"


def test_a_search_limit_gives_an_incomplete_answer(client):
    out = client.post(f"{BASE}/search", json=search_body(limits={"max_candidates": 4})).json()
    assert out["search"]["status"] == "incomplete" and out["search"]["complete"] is False


def test_a_refused_item_is_not_adjusted(client):
    out = client.post(f"{BASE}/search", json=search_body(excluded_item_ids=["flex"])).json()
    assert out["search"]["status"] == "infeasible"
    assert any("refused" in n for n in out["search"]["ignored_permissions"])


@pytest.mark.parametrize(
    "mutate",
    [
        lambda b: b["input"].update(liquid_cash="-1.00"),
        lambda b: b["input"].update(liquid_cash=300000),  # a JSON number
        lambda b: b["input"].update(months=0),
        lambda b: b["input"]["income"].clear(),
        lambda b: b["input"].update(
            adjustments=[
                {
                    "item_id": "home",
                    "action": "pause",
                    "from_month": "2026-11",
                    "to_month": "2026-12",
                }
            ]
        ),
        lambda b: b.update(excluded_item_ids=["nope"]),
        lambda b: b.update(adjust_from="2030-01"),
        lambda b: b.update(limits={"max_candidates": 0}),
        lambda b: b.update(unknown_field=1),
    ],
)
def test_invalid_search_requests_are_rejected(client, mutate):
    body = search_body()
    mutate(body)
    assert client.post(f"{BASE}/search", json=body).status_code == 422


def test_evaluate_runs_a_specified_plan(client):
    data = example(months=6, income_months=6)
    out = client.post(f"{BASE}/evaluate", json=data).json()
    assert out["feasible"] is False and out["final_liquid"] == "90000.00"


# ---- agreements ---------------------------------------------------------------------------------------------------


def test_an_agreement_is_saved_and_read_back_with_a_recomputed_evaluation(client):
    created = save(client)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["version"] == 1 and body["evaluation"]["final_liquid"] == "180000.00"
    assert body["changes_from_previous"] == [] and len(body["versions"]) == 1
    assert any("not a guarantee" in text for text in body["limitations"])
    again = client.get(f"{BASE}/agreements/{body['id']}").json()
    assert (
        again["draft"]["input"]["review_month"] == "2027-05"
        and again["evaluation"]["feasible"] is True
    )
    listed = client.get(f"{BASE}/agreements").json()
    assert [(a["name"], a["version"], a["feasible"], a["review_month"]) for a in listed] == [
        ("Job gap", 1, True, "2027-05")
    ]


def test_nothing_the_client_sends_as_a_total_is_stored_or_trusted(client):
    draft = chosen_draft(client)
    draft["input"]["final_liquid"] = "999999.00"  # extra fields are refused, not stored
    assert client.post(f"{BASE}/agreements", json={"name": "x", "draft": draft}).status_code == 422
    created = save(client).json()
    with SessionLocal() as db:
        row = (
            db.query(RecoveryAgreementVersion)
            .filter(RecoveryAgreementVersion.agreement_id == created["id"])
            .one()
        )
        assert "liquid_end" not in row.draft_json and "final_liquid" not in row.draft_json
        row.draft_json = json.dumps({"input": {"months": 6}})  # corrupt the stored draft
        db.commit()
    unreadable = client.get(f"{BASE}/agreements/{created['id']}")
    assert (
        unreadable.status_code == 500
        and unreadable.json()["error"]["code"] == "agreement_unreadable"
    )


def test_a_plan_that_breaks_the_persons_own_rules_cannot_be_saved(client):
    draft = chosen_draft(client)
    draft["input"]["adjustments"] = []  # nothing changed: cash falls below the floor
    refused = client.post(f"{BASE}/agreements", json={"name": "Bad", "draft": draft})
    assert refused.status_code == 422 and refused.json()["error"]["code"] == "plan_not_feasible"
    assert client.get(f"{BASE}/agreements").json() == []


def test_a_repeated_save_with_the_same_token_creates_one_agreement(client):
    one = save(client, client_token="token-12345678")
    two = save(client, name="Different name", client_token="token-12345678")
    assert one.json()["id"] == two.json()["id"]
    assert len(client.get(f"{BASE}/agreements").json()) == 1


def test_names_are_unique_per_user(client):
    assert save(client).status_code == 201
    assert save(client).status_code == 409
    assert save(authed_client("planb2")).status_code == 201


def test_editing_adds_a_version_and_keeps_the_old_one(client):
    created = save(client).json()
    revised_draft = chosen_draft(client)
    revised_draft["input"]["reserve_floor"] = "170000.00"
    revised_draft["rationale"] = "A little more room."
    revised = client.put(
        f"{BASE}/agreements/{created['id']}",
        json={"draft": revised_draft, "expected_version": 1, "change_note": "Lowered the floor."},
    )
    assert revised.status_code == 200, revised.text
    body = revised.json()
    assert body["version"] == 2 and [v["version"] for v in body["versions"]] == [1, 2]
    fields = {c["field"]: (c["before"], c["after"]) for c in body["changes_from_previous"]}
    assert (
        fields["Reserve floor"] == ("Rs 180,000.00", "Rs 170,000.00")
        and "Why you chose it" in fields
    )
    first = client.get(f"{BASE}/agreements/{created['id']}/versions/1").json()
    assert first["draft"]["input"]["reserve_floor"] == "180000.00" and first["version"] == 1
    assert client.get(f"{BASE}/agreements/{created['id']}/versions/9").status_code == 404


def test_a_stale_edit_is_refused_and_nothing_changes(client):
    created = save(client).json()
    draft = chosen_draft(client)
    assert (
        client.put(
            f"{BASE}/agreements/{created['id']}", json={"draft": draft, "expected_version": 1}
        ).status_code
        == 200
    )
    stale = client.put(
        f"{BASE}/agreements/{created['id']}", json={"draft": draft, "expected_version": 1}
    )
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "version_conflict"
    assert client.get(f"{BASE}/agreements/{created['id']}").json()["version"] == 2


def test_an_infeasible_edit_is_not_saved(client):
    created = save(client).json()
    draft = chosen_draft(client)
    draft["input"]["reserve_floor"] = "250000.00"
    bad = client.put(
        f"{BASE}/agreements/{created['id']}", json={"draft": draft, "expected_version": 1}
    )
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "plan_not_feasible"
    assert client.get(f"{BASE}/agreements/{created['id']}").json()["version"] == 1


def test_review_reports_whether_the_agreement_still_fits(client):
    created = save(client).json()
    url = f"{BASE}/agreements/{created['id']}/review"
    fits = client.post(
        url,
        json={"as_of_month": "2027-02", "liquid_cash": "240000.00", "monthly_income": "60000.00"},
    ).json()
    # Cash 240,000 at the start of February with 3 months left: 240 - 3 x 20 = 180 (the floor exactly).
    assert fits["status"] == "still_fits" and fits["fits"] is True
    assert fits["evaluation"]["final_liquid"] == "180000.00"
    worse = client.post(
        url,
        json={"as_of_month": "2027-02", "liquid_cash": "200000.00", "monthly_income": "50000.00"},
    ).json()
    assert worse["status"] == "needs_recalculation" and worse["fits"] is False
    assert any("recalculated" in m for m in worse["messages"])
    assert (
        client.post(
            url, json={"as_of_month": "2030-01", "liquid_cash": "1.00", "monthly_income": "1.00"}
        ).status_code
        == 422
    )
    assert (
        client.get(f"{BASE}/agreements/{created['id']}").json()["version"] == 1
    )  # a review saves nothing


# ---- ownership and data rights -----------------------------------------------------------------------------------


def test_another_user_cannot_see_change_review_or_delete_an_agreement(client):
    created = save(client).json()
    aid = created["id"]
    other = authed_client("intruder")
    draft = chosen_draft(client)
    assert other.get(f"{BASE}/agreements/{aid}").status_code == 404
    assert other.get(f"{BASE}/agreements/{aid}/versions/1").status_code == 404
    assert (
        other.put(
            f"{BASE}/agreements/{aid}", json={"draft": draft, "expected_version": 1}
        ).status_code
        == 404
    )
    assert (
        other.post(
            f"{BASE}/agreements/{aid}/review",
            json={"as_of_month": "2027-02", "liquid_cash": "1.00", "monthly_income": "1.00"},
        ).status_code
        == 404
    )
    assert other.delete(f"{BASE}/agreements/{aid}").status_code == 404
    assert other.get(f"{BASE}/agreements").json() == []
    assert client.get(f"{BASE}/agreements/{aid}").status_code == 200


def test_agreements_are_in_the_data_export_and_deleted_with_the_account(client):
    created = save(client).json()
    exported = client.get("/api/v1/auth/export-data").json()
    assert [(a["name"], a["version"]) for a in exported["recovery_agreements"]] == [("Job gap", 1)]
    assert client.delete("/api/v1/auth/delete-account").status_code == 200
    with SessionLocal() as db:
        assert (
            db.query(RecoveryAgreement).filter(RecoveryAgreement.id == created["id"]).count() == 0
        )
        assert (
            db.query(RecoveryAgreementVersion)
            .filter(RecoveryAgreementVersion.agreement_id == created["id"])
            .count()
            == 0
        )


def test_the_number_of_agreements_is_capped(client):
    for n in range(30):
        assert save(client, name=f"A{n}").status_code == 201
    over = save(client, name="A30")
    assert over.status_code == 422 and over.json()["error"]["code"] == "limit_reached"


def test_deleting_removes_the_agreement_and_its_versions(client):
    created = save(client).json()
    assert client.delete(f"{BASE}/agreements/{created['id']}").status_code == 204
    assert client.get(f"{BASE}/agreements/{created['id']}").status_code == 404
