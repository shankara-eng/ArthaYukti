"""Investment calculators over HTTP: validation, results, CSV, comparison, saved scenarios and ownership."""

import csv
import io
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.db.models import CalculatorScenario
from app.db.session import SessionLocal
from app.main import app
from tests.helpers import authed_client

D = Decimal
BASE = "/api/v1/calculators"


def investment(**kw) -> dict:
    body = {
        "id": "a",
        "name": "Fund A",
        "start_month": "2027-01",
        "lump_sum": "100000.00",
        "growth_years": 1,
        "annual_growth": "0.120000",
        "tax_rate": "0.1000",
    }
    body.update(kw)
    return body


def config(*items, **kw) -> dict:
    return {"investments": list(items) or [investment()], **kw}


def sip(amount="1000.00", years=1, frequency="monthly", step_ups=()):
    return {
        "amount": amount,
        "frequency": frequency,
        "contribution_years": years,
        "step_ups": list(step_ups),
    }


@pytest.fixture()
def client() -> TestClient:
    return authed_client("calc")


# ---- auth and validation -------------------------------------------------------------------------------


def test_every_calculator_route_needs_a_signed_in_user():
    anonymous = TestClient(app)
    assert anonymous.post(f"{BASE}/run", json=config()).status_code == 401
    assert anonymous.post(f"{BASE}/export", json=config()).status_code == 401
    assert anonymous.get(f"{BASE}/scenarios").status_code == 401


def test_a_run_returns_decimal_strings(client):
    body = client.post(f"{BASE}/run", json=config()).json()
    r = body["investments"][0]
    assert (
        r["value"] == "112682.51" and r["tax"] == "1268.25" and r["post_tax_value"] == "111414.26"
    )
    assert body["aggregate"]["post_tax_value"] == "111414.26"
    assert body["compilation"]["years"][0]["year"] == 2027


@pytest.mark.parametrize(
    "change",
    [
        {"annual_growth": 0.12},  # a JSON number, not a decimal string
        {"annual_growth": "-1.5"},
        {"annual_growth": "1.5"},
        {"tax_rate": "1.2"},
        {"inflation_rate": "-0.01"},
        {"growth_years": 0},
        {"growth_years": 61},
        {"lump_sum": "-5.00"},
        {"lump_sum": "0.00"},  # nothing invested
        {"start_month": "2027-13"},
        {"name": "  "},
        {"id": "has space"},
        {"sip": sip(years=3), "growth_years": 2},  # contributions would outlast growth
        {
            "sip": sip(step_ups=[{"from_year": 2, "mode": "amount", "amount": "2000.00"}])
        },  # step-up after contributions stop
        {
            "sip": sip(
                years=3,
                step_ups=[
                    {"from_year": 2, "amount": "2000.00"},
                    {"from_year": 2, "amount": "3000.00"},
                ],
            ),
            "growth_years": 3,
        },
        {"sip": sip(years=2, step_ups=[{"from_year": 2, "mode": "percent"}]), "growth_years": 2},
        {"sip": {**sip(), "frequency": "weekly"}},
        {"sip": {**sip(), "amount": "0.00"}},
        {"unknown_field": 1},
    ],
)
def test_invalid_investments_are_rejected(client, change):
    response = client.post(f"{BASE}/run", json=config(investment(**change)))
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] in ("validation_error", "invalid_request")


def test_config_level_validation(client):
    assert (
        client.post(f"{BASE}/run", json=config(mode="common_date")).status_code == 422
    )  # no common date
    assert (
        client.post(f"{BASE}/run", json=config(common_date="2030-01")).status_code == 422
    )  # date without the mode
    assert (
        client.post(f"{BASE}/run", json=config(investment(), investment(name="Again"))).status_code
        == 422
    )  # duplicate id
    assert client.post(f"{BASE}/run", json=config(compile_ids=["zzz"])).status_code == 422
    assert client.post(f"{BASE}/run", json=config(compile_ids=["a", "a"])).status_code == 422
    assert client.post(f"{BASE}/run", json={"investments": []}).status_code == 422
    too_many = [investment(id=f"i{n}") for n in range(21)]
    assert client.post(f"{BASE}/run", json=config(*too_many)).status_code == 422


def test_common_date_after_maturity_needs_a_decision_and_the_check_names_it(client):
    body = config(mode="common_date", common_date="2029-06")
    refused = client.post(f"{BASE}/run", json=body)
    assert (
        refused.status_code == 422
        and refused.json()["error"]["code"] == "maturity_decision_required"
    )
    needed = client.post(f"{BASE}/maturity-check", json=body).json()
    assert needed == [{"investment_id": "a", "name": "Fund A", "matures": "2027-12"}]
    decided = config(
        investment(after_maturity={"action": "hold"}), mode="common_date", common_date="2029-06"
    )
    assert client.post(f"{BASE}/maturity-check", json=decided).json() == []
    assert client.post(f"{BASE}/run", json=decided).status_code == 200
    assert (
        client.post(
            f"{BASE}/run",
            json=config(
                investment(after_maturity={"action": "reinvest"}),
                mode="common_date",
                common_date="2029-06",
            ),
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"{BASE}/run",
            json=config(
                investment(after_maturity={"action": "hold", "rate": "0.05"}),
                mode="common_date",
                common_date="2029-06",
            ),
        ).status_code
        == 422
    )


# ---- CSV reconciles with the screen --------------------------------------------------------------------


def parse(csv_text: str) -> list[list[str]]:
    return list(csv.reader(io.StringIO(csv_text.lstrip("﻿"))))


def test_csv_matches_the_run_result(client):
    body = config(
        investment(
            id="a",
            name="Fund A",
            sip=sip("2000.00", 2, "quarterly"),
            growth_years=3,
            lump_sum="10000.00",
        ),
        investment(
            id="b", name="Fund B", lump_sum="50000.00", annual_growth="-0.050000", tax_rate="0.2000"
        ),
    )
    result = client.post(f"{BASE}/run", json=body).json()
    response = client.post(f"{BASE}/export", json=body)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers["content-disposition"]
    assert response.content.startswith(b"\xef\xbb\xbf")
    rows = parse(response.text)
    summary_at = rows.index(["Summary"]) + 2
    for offset, r in enumerate(result["investments"]):
        row = rows[summary_at + offset]
        assert row[0] == r["name"] and row[4] == r["principal"] and row[5] == r["value"]
        assert row[6] == r["gain"] and row[7] == r["tax"] and row[8] == r["post_tax_value"]
    total = rows[summary_at + len(result["investments"])]
    assert (
        total[0] == "Total"
        and total[4] == result["aggregate"]["principal"]
        and total[8] == result["aggregate"]["post_tax_value"]
    )
    annual_at = rows.index(["Annual breakdown"]) + 2
    flat = [(r["name"], row) for r in result["investments"] for row in r["annual"]]
    for offset, (name, a) in enumerate(flat):
        line = rows[annual_at + offset]
        assert (
            line[0] == name
            and line[1] == str(a["year"])
            and line[6] == a["opening"]
            and line[9] == a["closing"]
        )
    compiled_at = next(
        i for i, r in enumerate(rows) if r and r[0] == "Year" and "Closing total" in r
    )
    for offset, y in enumerate(result["compilation"]["years"]):
        assert (
            rows[compiled_at + 1 + offset][0] == str(y["year"])
            and rows[compiled_at + 1 + offset][4] == y["closing_total"]
        )


def test_csv_neutralises_spreadsheet_formulas_in_names(client):
    text = client.post(f"{BASE}/export", json=config(investment(name="=HYPERLINK(1)"))).text
    assert "'=HYPERLINK(1)" in text and ",=HYPERLINK" not in text


# ---- saved scenarios: persistence, ownership -----------------------------------------------------------


def test_scenarios_are_saved_listed_updated_and_deleted(client):
    saved = client.post(
        f"{BASE}/scenarios",
        json={
            "name": "Retirement",
            "config": config(investment(sip=sip("500.00", 2), growth_years=5)),
        },
    )
    assert saved.status_code == 201
    sid = saved.json()["id"]
    assert saved.json()["config"]["investments"][0]["sip"]["amount"] == "500.00"
    listed = client.get(f"{BASE}/scenarios").json()
    assert [(s["name"], s["investments"], s["mode"]) for s in listed] == [
        ("Retirement", 1, "individual")
    ]
    changed = client.put(
        f"{BASE}/scenarios/{sid}",
        json={"name": "Retirement v2", "config": config(investment(id="x"), investment(id="y"))},
    )
    assert changed.status_code == 200 and changed.json()["name"] == "Retirement v2"
    assert len(client.get(f"{BASE}/scenarios/{sid}").json()["config"]["investments"]) == 2
    assert client.delete(f"{BASE}/scenarios/{sid}").status_code == 204
    assert client.get(f"{BASE}/scenarios/{sid}").status_code == 404
    assert client.get(f"{BASE}/scenarios").json() == []


def test_scenario_names_are_unique_per_user_and_the_saved_config_is_validated(client):
    first = client.post(f"{BASE}/scenarios", json={"name": "Plan", "config": config()})
    assert first.status_code == 201
    assert (
        client.post(f"{BASE}/scenarios", json={"name": "Plan", "config": config()}).status_code
        == 409
    )
    other = client.post(f"{BASE}/scenarios", json={"name": "Other", "config": config()}).json()[
        "id"
    ]
    assert (
        client.put(
            f"{BASE}/scenarios/{other}", json={"name": "Plan", "config": config()}
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"{BASE}/scenarios",
            json={"name": "Bad", "config": config(investment(annual_growth="9"))},
        ).status_code
        == 422
    )
    # The same name is fine for another account.
    assert (
        authed_client("calc2")
        .post(f"{BASE}/scenarios", json={"name": "Plan", "config": config()})
        .status_code
        == 201
    )


def test_one_user_cannot_read_change_delete_or_compare_another_users_scenario(client):
    sid = client.post(f"{BASE}/scenarios", json={"name": "Private", "config": config()}).json()[
        "id"
    ]
    intruder = authed_client("intruder")
    assert intruder.get(f"{BASE}/scenarios/{sid}").status_code == 404
    assert (
        intruder.put(
            f"{BASE}/scenarios/{sid}", json={"name": "Mine now", "config": config()}
        ).status_code
        == 404
    )
    assert intruder.delete(f"{BASE}/scenarios/{sid}").status_code == 404
    assert intruder.get(f"{BASE}/scenarios").json() == []
    stolen = intruder.post(
        f"{BASE}/compare", json={"entries": [{"scenario_id": sid}, {"config": config()}]}
    )
    assert stolen.status_code == 404
    assert client.get(f"{BASE}/scenarios/{sid}").status_code == 200  # untouched


def test_saved_scenarios_are_part_of_the_data_export_and_removed_with_the_account(client):
    client.post(f"{BASE}/scenarios", json={"name": "Kept", "config": config()})
    exported = client.get("/api/v1/auth/export-data").json()
    assert [s["name"] for s in exported["calculator_scenarios"]] == ["Kept"]
    sid = exported["calculator_scenarios"][0]["id"]
    assert client.delete("/api/v1/auth/delete-account").status_code == 200
    with SessionLocal() as db:
        assert db.query(CalculatorScenario).filter(CalculatorScenario.id == sid).count() == 0


def test_the_number_of_saved_scenarios_is_capped(client):
    for n in range(50):
        assert (
            client.post(f"{BASE}/scenarios", json={"name": f"S{n}", "config": config()}).status_code
            == 201
        )
    over = client.post(f"{BASE}/scenarios", json={"name": "S50", "config": config()})
    assert over.status_code == 422 and over.json()["error"]["code"] == "limit_reached"


# ---- comparison never double counts --------------------------------------------------------------------


def test_comparison_values_each_scenario_alone_and_never_adds_alternatives(client):
    a = config(investment(id="a", lump_sum="100000.00"))
    b = config(
        investment(id="a", lump_sum="100000.00", annual_growth="0.100000")
    )  # the same id, an alternative to a
    sid = client.post(f"{BASE}/scenarios", json={"name": "Base", "config": a}).json()["id"]
    body = client.post(
        f"{BASE}/compare",
        json={
            "entries": [
                {"scenario_id": sid},
                {"config": b, "label": "Slower"},
                {"config": a, "label": "Same again"},
            ]
        },
    ).json()
    rows = body["rows"]
    assert [r["label"] for r in rows] == ["Base", "Slower", "Same again"]
    assert (
        rows[0]["aggregate"]["principal"] == "100000.00" == rows[2]["aggregate"]["principal"]
    )  # not 200000
    assert (
        rows[0]["aggregate"]["post_tax_value"]
        == rows[2]["aggregate"]["post_tax_value"]
        == "111414.26"
    )
    assert rows[0]["delta_post_tax_vs_first"] == "0.00"
    slower = D(rows[1]["aggregate"]["post_tax_value"]) - D(rows[0]["aggregate"]["post_tax_value"])
    assert D(rows[1]["delta_post_tax_vs_first"]) == slower and slower < 0


def test_comparison_can_value_every_entry_at_one_common_date(client):
    short = config(investment(id="a", after_maturity={"action": "hold"}))
    long = config(investment(id="a", growth_years=3, after_maturity={"action": "hold"}))
    rows = client.post(
        f"{BASE}/compare",
        json={"entries": [{"config": short}, {"config": long}], "common_date": "2028-12"},
    ).json()["rows"]
    assert all(r["mode"] == "common_date" and r["common_date"] == "2028-12" for r in rows)
    assert D(rows[0]["aggregate"]["value"]) == D("112682.51")  # matured in 2027 and held
    assert D(rows[1]["aggregate"]["value"]) > D("112682.51")  # still growing at the common date


def test_comparison_input_rules(client):
    assert (
        client.post(f"{BASE}/compare", json={"entries": [{"config": config()}]}).status_code == 422
    )
    assert (
        client.post(f"{BASE}/compare", json={"entries": [{"config": config()}] * 5}).status_code
        == 422
    )
    assert (
        client.post(
            f"{BASE}/compare",
            json={"entries": [{"config": config(), "scenario_id": "x"}, {"config": config()}]},
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"{BASE}/compare",
            json={"entries": [{"scenario_id": "no-such-id"}, {"config": config()}]},
        ).status_code
        == 404
    )
