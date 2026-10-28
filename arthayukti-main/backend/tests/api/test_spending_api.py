"""Expenditure plans API: validation, lifecycle, categories, settings, trajectory and CSV, plus tenant isolation."""

import csv
import io
from datetime import date

import pytest

from app.api import spending
from tests.helpers import authed_client

TODAY = date(2026, 10, 25)


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch):
    monkeypatch.setattr(spending, "_today", lambda: TODAY)


def plan_body(**extra):
    body = {"category": "sys:housing", "amount": "5000.00", "frequency": "monthly", "duration": "today_forever"}
    body.update(extra)
    return body


def make(client, **extra):
    response = client.post("/api/v1/expenditure/plans", json=plan_body(**extra))
    assert response.status_code == 201, response.text
    return response.json()


def rows(client):
    return {r["year"]: r for r in client.get("/api/v1/expenditure/trajectory").json()["years"]}


def test_settings_default_to_six_percent_and_a_five_year_horizon():
    client = authed_client()
    settings = client.get("/api/v1/expenditure/settings").json()
    assert settings["base_inflation"] == "0.060000" and settings["horizon_years"] == 5
    assert settings["horizon_presets"] == [1, 5, 10, 20, 30]


def test_an_empty_trajectory_is_zero_not_invented():
    client = authed_client()
    body = client.get("/api/v1/expenditure/trajectory").json()
    assert body["plans_included"] == 0 and body["total_with_inflation"] == "0.00"


def test_a_plan_starting_today_projects_only_the_remaining_months():
    client = authed_client()
    make(client)
    client.put("/api/v1/expenditure/settings", json={"horizon_years": 1})
    years = rows(client)
    # Oct 2026 - Sep 2027: Oct-Dec at 5,000 = 15,000; 2027 steps to 5,300 for 9 months = 47,700.
    assert years[2026]["annual_with_inflation"] == "15000.00" and years[2026]["months_included"] == 3
    assert years[2027]["annual_with_inflation"] == "47700.00"
    assert years[2027]["cumulative_with_inflation"] == "62700.00"
    assert years[2027]["cumulative_without_inflation"] == "60000.00"


def test_a_yearly_amount_is_a_twelfth_a_month_and_never_counted_as_well():
    client = authed_client()
    plan = make(client, amount="24000.00", frequency="yearly", duration="range", start_year=2027, end_year=2028)
    assert plan["monthly_equivalent"] == "2000.00"
    years = rows(client)
    assert years[2027]["annual_with_inflation"] == "24000.00" and years[2028]["annual_with_inflation"] == "25440.00"
    assert 2029 not in years or years[2029]["annual_with_inflation"] == "0.00"


@pytest.mark.parametrize(
    "extra,code",
    [
        ({"duration": "range", "start_year": 2026, "start_month": 9, "end_year": 2027, "end_month": 1}, "start_in_past"),
        ({"duration": "range", "start_year": 2025, "start_month": 12, "end_year": 2027, "end_month": 1}, "start_in_past"),
        ({"duration": "range", "start_year": 2027, "start_month": 5, "end_year": 2027, "end_month": 4}, "end_before_start"),
        ({"duration": "range", "start_year": 2027, "start_month": 5}, "invalid_duration"),
        ({"duration": "year_forever", "start_year": 2025}, "start_in_past"),
        ({"duration": "today_forever", "start_year": 2027}, "invalid_duration"),
        ({"frequency": "yearly", "duration": "range", "start_year": 2027, "start_month": 1, "end_year": 2028}, "invalid_duration"),
    ],
)
def test_invalid_durations_are_refused_with_a_reason(extra, code):
    response = authed_client().post("/api/v1/expenditure/plans", json=plan_body(**extra))
    assert response.status_code == 422 and response.json()["error"]["code"] == code


def test_a_plan_may_end_in_its_start_month_and_the_end_month_is_inclusive():
    client = authed_client()
    make(client, duration="range", start_year=2027, start_month=3, end_year=2027, end_month=3)
    assert rows(client)[2027]["annual_with_inflation"] == "5000.00"  # exactly one month, March 2027, at the exact starting amount


def test_amounts_must_be_positive_decimal_strings():
    client = authed_client()
    for bad in ("0.00", "-5.00", "abc"):
        assert client.post("/api/v1/expenditure/plans", json=plan_body(amount=bad)).status_code == 422
    assert client.post("/api/v1/expenditure/plans", json=plan_body(amount=5000)).status_code == 422  # a JSON number


def test_global_rate_change_recalculates_inheriting_plans_but_not_overrides():
    client = authed_client()
    make(client)
    make(client, category="sys:groceries", inflation_override="0.000000")
    client.put("/api/v1/expenditure/settings", json={"horizon_years": 2})
    before = rows(client)[2027]["annual_with_inflation"]
    response = client.post("/api/v1/expenditure/settings/inflation", json={"rate": "0.100000", "mode": "recalculate_all"})
    assert response.status_code == 200 and response.json()["current_inflation"] == "0.100000"
    after = rows(client)[2027]["annual_with_inflation"]
    # 12 x 5,000 x 1.10 = 66,000 for the housing plan; the 0% override stays 12 x 5,000 = 60,000.
    assert before != after and after == "126000.00"


def test_a_scheduled_rate_change_keeps_the_earlier_rate_before_its_date():
    client = authed_client()
    make(client)
    client.put("/api/v1/expenditure/settings", json={"horizon_years": 3})
    client.post("/api/v1/expenditure/settings/inflation", json={"rate": "0.100000", "mode": "from_date", "effective_year": 2028, "effective_month": 1})
    years = rows(client)
    assert years[2027]["annual_with_inflation"] == "63600.00"  # the January 2027 step still used 6%
    assert years[2028]["annual_with_inflation"] == "69960.00"  # 5,300 x 1.10 = 5,830 a month
    bad = client.post("/api/v1/expenditure/settings/inflation", json={"rate": "0.1", "mode": "from_date", "effective_year": 2026, "effective_month": 1})
    assert bad.status_code == 422
    assert client.post("/api/v1/expenditure/settings/inflation", json={"rate": "-0.01", "mode": "recalculate_all"}).status_code == 422


def test_permanent_and_temporary_changes_follow_the_documented_rules():
    client = authed_client()
    plan = make(client, amount="8000.00", duration="year_forever", start_year=2027)
    url = f"/api/v1/expenditure/plans/{plan['id']}/changes"
    assert client.post(url, json={"kind": "permanent", "effective_year": 2028, "effective_month": 1, "amount": "12000.00"}).status_code == 201
    assert client.post(url, json={"kind": "temporary", "effective_year": 2029, "effective_month": 1, "end_year": 2029, "end_month": 6, "amount": "9000.00"}).status_code == 201
    client.put("/api/v1/expenditure/settings", json={"horizon_years": 4})
    years = rows(client)
    assert years[2027]["annual_with_inflation"] == "96000.00" and years[2028]["annual_with_inflation"] == "144000.00"
    # 2029: Jan-Jun = 6 x 9,000 override; Jul-Dec = 6 x 12,720 underlying.
    assert years[2029]["annual_with_inflation"] == "130320.00"
    duplicate = client.post(url, json={"kind": "permanent", "effective_year": 2028, "effective_month": 1, "amount": "1.00"})
    overlap = client.post(url, json={"kind": "temporary", "effective_year": 2029, "effective_month": 6, "end_year": 2029, "end_month": 8, "amount": "1.00"})
    early = client.post(url, json={"kind": "permanent", "effective_year": 2026, "effective_month": 1, "amount": "1.00"})
    assert (duplicate.status_code, overlap.status_code, early.status_code) == (409, 409, 422)
    assert client.post(url, json={"kind": "permanent", "effective_year": 2028, "amount": "1.00"}).status_code == 422  # a monthly plan needs a month


def test_stopping_excludes_the_plan_and_reactivating_restores_it_without_a_copy():
    client = authed_client()
    plan = make(client)
    client.put("/api/v1/expenditure/settings", json={"horizon_years": 1})
    stopped = client.post(f"/api/v1/expenditure/plans/{plan['id']}/stop")
    assert stopped.status_code == 200 and stopped.json()["status"] == "stopped"
    assert client.get("/api/v1/expenditure/trajectory").json()["total_with_inflation"] == "0.00"
    assert client.put(f"/api/v1/expenditure/plans/{plan['id']}", json=plan_body()).status_code == 409
    assert client.post(f"/api/v1/expenditure/plans/{plan['id']}/stop").status_code == 409
    back = client.post(f"/api/v1/expenditure/plans/{plan['id']}/reactivate")
    assert back.status_code == 200 and back.json()["status"] == "active" and back.json()["end_year"] is None
    assert len(client.get("/api/v1/expenditure/plans").json()) == 1
    assert client.get("/api/v1/expenditure/trajectory").json()["total_with_inflation"] == "62700.00"


def test_categories_rename_hide_archive_and_unsafe_delete():
    client = authed_client()
    mine = client.post("/api/v1/expenditure/categories", json={"name": "Pets"}).json()
    assert client.post("/api/v1/expenditure/categories", json={"name": "pets"}).status_code == 409
    assert client.post("/api/v1/expenditure/categories", json={"name": "Healthcare"}).status_code == 409  # a predefined name
    plan = make(client, category=mine["id"])
    total_before = client.get("/api/v1/expenditure/trajectory").json()["total_with_inflation"]
    renamed = client.put(f"/api/v1/expenditure/categories/{mine['id']}", json={"name": "Pet care"}).json()
    assert renamed["name"] == "Pet care" and renamed["plan_count"] == 1
    assert client.get("/api/v1/expenditure/plans").json()[0]["category_name"] == "Pet care"
    assert client.get("/api/v1/expenditure/trajectory").json()["total_with_inflation"] == total_before  # renaming changes no figure
    in_use = client.delete(f"/api/v1/expenditure/categories/{mine['id']}")
    assert in_use.status_code == 409 and in_use.json()["error"]["code"] == "category_in_use"
    hidden = client.put("/api/v1/expenditure/categories/system/travel", json={"hidden": True}).json()
    assert hidden["hidden"] is True and hidden["kind"] == "system"
    assert client.post("/api/v1/expenditure/plans", json=plan_body(category="sys:travel")).status_code == 422
    client.put(f"/api/v1/expenditure/categories/{mine['id']}", json={"archived": True})
    assert client.post("/api/v1/expenditure/plans", json=plan_body(category=mine["id"])).status_code == 422
    moved = client.delete(f"/api/v1/expenditure/categories/{mine['id']}", params={"reassign_to": "sys:other"})
    assert moved.status_code == 204
    assert client.get("/api/v1/expenditure/plans").json()[0]["category"] == "sys:other"
    assert plan["id"] == client.get("/api/v1/expenditure/plans").json()[0]["id"]
    assert all(c["kind"] == "system" for c in client.get("/api/v1/expenditure/categories").json())


def test_csv_is_the_current_trajectory_with_separate_columns_and_updates_after_changes():
    client = authed_client()
    make(client, name='Rent, "main"')
    client.put("/api/v1/expenditure/settings", json={"horizon_years": 2})
    response = client.get("/api/v1/expenditure/trajectory.csv")
    assert response.status_code == 200 and response.content.startswith(b"\xef\xbb\xbf")
    assert "attachment" in response.headers["content-disposition"] and "2026-10-25" in response.headers["content-disposition"]
    table = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert table[0] == ["Year", "Annual expenditure with inflation", "Cumulative expenditure with inflation",
                        "Cumulative expenditure without inflation", "Months included"]
    shown = client.get("/api/v1/expenditure/trajectory").json()["years"]
    assert [row[:4] for row in table[1:]] == [
        [str(y["year"]), y["annual_with_inflation"], y["cumulative_with_inflation"], y["cumulative_without_inflation"]] for y in shown
    ]
    client.put("/api/v1/expenditure/settings", json={"horizon_years": 1})
    assert len(list(csv.reader(io.StringIO(client.get("/api/v1/expenditure/trajectory.csv").content.decode("utf-8-sig"))))) < len(table)
    monthly = list(csv.reader(io.StringIO(client.get("/api/v1/expenditure/trajectory.csv", params={"granularity": "monthly"}).content.decode("utf-8-sig"))))
    assert monthly[0][:2] == ["Year", "Month"] and len(monthly) == 13
    assert client.get("/api/v1/expenditure/trajectory.csv", params={"granularity": "weekly"}).status_code == 422


def test_an_empty_export_is_just_the_header():
    table = list(csv.reader(io.StringIO(authed_client().get("/api/v1/expenditure/trajectory.csv").content.decode("utf-8-sig"))))
    assert table[0][0] == "Year" and all(row[1] == "0.00" for row in table[1:])


def test_horizon_must_be_between_one_and_fifty_years():
    client = authed_client()
    assert client.put("/api/v1/expenditure/settings", json={"horizon_years": 0}).status_code == 422
    assert client.put("/api/v1/expenditure/settings", json={"horizon_years": 51}).status_code == 422
    assert client.put("/api/v1/expenditure/settings", json={"horizon_years": 7}).json()["horizon_years"] == 7


def test_another_persons_data_is_invisible_and_untouchable():
    owner, other = authed_client("owner"), authed_client("other")
    plan = make(owner)
    cat = owner.post("/api/v1/expenditure/categories", json={"name": "Mine"}).json()
    change_url = f"/api/v1/expenditure/plans/{plan['id']}/changes"
    checks = [
        other.put(f"/api/v1/expenditure/plans/{plan['id']}", json=plan_body()),
        other.delete(f"/api/v1/expenditure/plans/{plan['id']}"),
        other.post(f"/api/v1/expenditure/plans/{plan['id']}/stop"),
        other.post(change_url, json={"kind": "permanent", "effective_year": 2027, "effective_month": 1, "amount": "1.00"}),
        other.put(f"/api/v1/expenditure/categories/{cat['id']}", json={"name": "Stolen"}),
        other.delete(f"/api/v1/expenditure/categories/{cat['id']}"),
    ]
    assert [r.status_code for r in checks] == [404] * 6
    assert other.post("/api/v1/expenditure/plans", json=plan_body(category=cat["id"])).status_code == 422
    assert other.get("/api/v1/expenditure/plans").json() == []
    assert other.get("/api/v1/expenditure/trajectory").json()["plans_included"] == 0
    assert len(owner.get("/api/v1/expenditure/plans").json()) == 1


def test_it_requires_signing_in():
    from fastapi.testclient import TestClient

    from app.main import app

    assert TestClient(app).get("/api/v1/expenditure/trajectory").status_code == 401


def test_spending_data_is_part_of_the_export_and_removed_with_the_account():
    from app.db.models import ExpenditureCategory, ExpenditureChange, ExpenditurePlan
    from app.db.session import SessionLocal

    client = authed_client()
    category = client.post("/api/v1/expenditure/categories", json={"name": "Pets"}).json()
    plan = make(client, category=category["id"])
    client.post(f"/api/v1/expenditure/plans/{plan['id']}/changes", json={"kind": "permanent", "effective_year": 2027, "effective_month": 1, "amount": "6000.00"})
    exported = client.get("/api/v1/auth/export-data").json()["expenditure"]
    assert [p["id"] for p in exported["plans"]] == [plan["id"]] and len(exported["plans"][0]["changes"]) == 1
    assert any(c["id"] == category["id"] for c in exported["categories"]) and exported["settings"]["base_inflation"] == "0.060000"
    assert client.delete("/api/v1/auth/delete-account").status_code == 200
    with SessionLocal() as db:
        assert db.query(ExpenditurePlan).filter(ExpenditurePlan.id == plan["id"]).count() == 0
        assert db.query(ExpenditureCategory).filter(ExpenditureCategory.id == category["id"]).count() == 0
        assert db.query(ExpenditureChange).filter(ExpenditureChange.plan_id == plan["id"]).count() == 0


def test_first_requests_made_at_the_same_time_do_not_fail():
    from concurrent.futures import ThreadPoolExecutor

    client = authed_client()
    paths = ["/settings", "/categories", "/trajectory", "/plans"] * 3
    with ThreadPoolExecutor(max_workers=6) as pool:
        codes = list(pool.map(lambda path: client.get(f"/api/v1/expenditure{path}").status_code, paths))
    assert codes == [200] * len(paths)
