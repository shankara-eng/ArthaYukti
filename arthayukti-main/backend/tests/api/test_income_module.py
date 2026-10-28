"""Planned income: schema rules, trajectory, projection endpoint and CSV.

Expected values are worked out here by hand or with plain Decimal arithmetic, never by calling the engine.
"""

import csv
import io
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.engine.flows import month_flows
from app.engine.money import engine_context
from app.engine.setup import resolve
from app.main import app
from app.schemas.plan import Plan
from tests.helpers import authed_client

D = Decimal
URL = "/api/v1/income/projection"


def base_plan(c, streams, as_of="2026-10", expenses="0.00"):
    plan = c.get("/api/v1/samples/family_stretched").json()["plan"]
    plan["as_of"] = as_of
    plan["income_streams"] = streams
    plan["expenses"] = [{"id": "x", "label": "Living", "monthly": expenses, "essential": True}] if expenses != "0.00" else []
    plan["commitments"] = []
    plan["goals"] = [{"id": "g", "label": "G", "type": "custom", "target_amount_today": "100000.00", "target_date": "2030-12", "priority": 1, "inflation_linked": False, "inflation_rate_override": None, "current_savings": "0.00"}]
    plan["assumptions"] = {**plan["assumptions"], "income_growth_annual": "0.000000", "expense_growth_annual": "0.000000"}
    return plan


def stream(id="s1", amount="50000.00", frequency="monthly", start=2026, end=None, growth=None, steps=(), label=None):
    body = {"id": id, "label": label or id.upper(), "monthly_net": "0.00", "amount": amount, "frequency": frequency, "start_year": start,
            "step_ups": [{"id": f"u{y}", "year": y, "amount": a} for y, a in steps]}
    if end is not None:
        body["end_year"] = end
    if growth is not None:
        body["annual_growth"] = growth
    return body


def monthly_income(plan_json: dict, t: int) -> Decimal:
    plan = Plan.model_validate(plan_json)
    with engine_context():
        return month_flows(resolve(plan, None), t).income


def project(c, plan, months):
    r = c.post(URL, json={"plan": plan, "horizon_months": months})
    assert r.status_code == 200, r.text[:400]
    return r.json()


@pytest.mark.parametrize(("amount", "frequency"), [("50000.00", "monthly"), ("150000.00", "quarterly"), ("600000.00", "yearly")])
def test_frequencies_normalise_to_the_same_monthly_amount_once(amount, frequency):
    c = authed_client("inc1")
    plan = base_plan(c, [stream(amount=amount, frequency=frequency, start=2027)], as_of="2027-01")
    assert Plan.model_validate(plan).income_streams[0].monthly_net == D("50000.00")
    assert monthly_income(plan, 1) == D("50000.00")
    assert monthly_income(plan, 12) == D("50000.00")
    assert project(c, plan, 12)["years"][0]["annual_income"] == "600000.00"  # not counted twice, not multiplied again


def test_fractional_paise_are_rounded_once_per_month_not_in_the_normalisation():
    c = authed_client("inc2")
    # 100,000 a quarter is 33,333.333... a month: each month rounds to 33,333.33, a year totals 399,999.96.
    plan = base_plan(c, [stream(amount="100000.00", frequency="quarterly", start=2027)], as_of="2027-01")
    assert project(c, plan, 12)["years"][0]["annual_income"] == "399999.96"
    # Growth compounds on the unrounded base: 33,333.333.. x 1.05 = 35,000.00 exactly.
    plan = base_plan(c, [stream(amount="100000.00", frequency="quarterly", start=2027, growth="0.050000")], as_of="2027-01")
    assert monthly_income(plan, 13) == D("35000.00")


def test_calendar_years_partial_first_year_future_start_and_inclusive_end():
    c = authed_client("inc3")
    plan = base_plan(c, [stream("a", amount="10000.00", start=2026, end=2027), stream("b", amount="20000.00", start=2028)], as_of="2026-10")
    years = {y["year"]: y for y in project(c, plan, 60)["years"]}
    assert years[2026]["months_included"] == 3 and years[2026]["annual_income"] == "30000.00"  # Oct-Dec only
    assert years[2027]["annual_income"] == "120000.00"
    assert years[2028]["annual_income"] == "240000.00"  # a ended in December 2027, b starts in January 2028
    assert monthly_income(plan, 15) == D("10000.00")  # Dec 2027 still includes a
    assert monthly_income(plan, 16) == D("20000.00")  # Jan 2028: only b
    assert years[2030]["months_included"] == 12 and years[2030]["annual_income"] == "240000.00"
    # The 60-month horizon ends in September 2031: the last year holds only nine months.
    assert years[2031]["months_included"] == 9 and years[2031]["annual_income"] == "180000.00"
    one = base_plan(c, [stream(amount="10000.00", start=2027, end=2027)], as_of="2027-01")
    assert [y["annual_income"] for y in project(c, one, 36)["years"]] == ["120000.00", "0.00", "0.00"]


def test_growth_trajectory_five_percent_and_blank_and_independent_rates():
    c = authed_client("inc4")
    a_only = base_plan(c, [stream("a", start=2027, growth="0.050000")], as_of="2027-01")
    for year_index, value in enumerate([D("50000"), D("52500"), D("55125"), D("57881.25")]):
        assert monthly_income(a_only, year_index * 12 + 1) == value
    plan = base_plan(c, [stream("a", start=2027, growth="0.050000"), stream("b", amount="10000.00", start=2027), stream("c", amount="10000.00", start=2027, growth="0.000000"), stream("d", amount="10000.00", start=2027, growth="0.100000")], as_of="2027-01")
    # Blank and explicit zero never grow; the 10% stream grows by its own rate: 10,000 x 1.1^3 = 13,310.
    assert monthly_income(plan, 37) == D("57881.25") + D("10000") + D("10000") + D("13310.00")


def test_step_up_replaces_the_base_and_growth_resumes_from_it():
    c = authed_client("inc5")
    plan = base_plan(c, [stream(start=2026, growth="0.050000", steps=[(2028, "60000.00")])], as_of="2026-01")
    expected = {2026: D("50000"), 2027: D("52500"), 2028: D("60000"), 2029: D("63000"), 2030: D("66150")}
    for year, value in expected.items():
        assert monthly_income(plan, (year - 2026) * 12 + 1) == value, year
        assert monthly_income(plan, (year - 2026) * 12 + 12) == value, year
    plan = base_plan(c, [stream(start=2026, steps=[(2028, "60000.00"), (2030, "75000.00"), (2032, "95000.00")])], as_of="2026-01")
    got = [monthly_income(plan, (y - 2026) * 12 + 1) for y in range(2026, 2034)]
    assert got == [D(v) for v in (50000, 50000, 60000, 60000, 75000, 75000, 95000, 95000)]


def test_step_up_amount_uses_the_streams_frequency():
    c = authed_client("inc6")
    plan = base_plan(c, [stream(amount="150000.00", frequency="quarterly", start=2026, steps=[(2027, "180000.00")])], as_of="2026-01")
    assert monthly_income(plan, 1) == D("50000.00") and monthly_income(plan, 13) == D("60000.00")


def test_an_ended_stream_never_comes_back_through_growth_or_steps():
    c = authed_client("inc7")
    plan = base_plan(c, [stream(start=2026, end=2027, growth="0.100000", steps=[(2027, "70000.00")])], as_of="2026-01")
    assert monthly_income(plan, 24) == D("70000.00") and monthly_income(plan, 25) == D("0.00")
    assert monthly_income(plan, 60) == D("0.00")


@pytest.mark.parametrize(
    "bad",
    [
        {"start": 2025},
        {"start": 2027, "end": 2026},
        {"growth": "-0.010000"},
        {"amount": "0.00"},
        {"steps": [(2026, "60000.00")]},
        {"steps": [(2029, "60000.00")], "end": 2028},
        {"steps": [(2028, "60000.00"), (2028, "70000.00")]},
        {"steps": [(2028, "0.00")]},
        {"frequency": "weekly"},
    ],
)
def test_invalid_schedules_are_rejected_not_repaired(bad):
    c = authed_client("inc8")
    kwargs = {"start": 2026, **bad}
    plan = base_plan(c, [stream(**kwargs)], as_of="2026-10")
    assert c.post("/api/v1/plans", json=plan).status_code == 422, bad
    assert c.post(URL, json={"plan": plan}).status_code == 422


def test_blank_name_and_mixed_forms_are_rejected():
    c = authed_client("inc9")
    blank = base_plan(c, [{**stream(), "label": "   "}])
    assert c.post("/api/v1/plans", json=blank).status_code == 422
    mixed = base_plan(c, [{**stream(), "ends_after": "2030-01"}])
    assert c.post("/api/v1/plans", json=mixed).status_code == 422
    orphan = base_plan(c, [{"id": "s", "label": "S", "monthly_net": "1000.00", "end_year": 2030}])
    assert c.post("/api/v1/plans", json=orphan).status_code == 422


def test_more_than_four_streams_are_saved_reloaded_and_projected_without_loss():
    c = authed_client("inc10")
    streams = [stream(f"s{i}", amount=f"{(i + 1) * 1000}.00", start=2027) for i in range(9)]
    plan = base_plan(c, streams, as_of="2027-01")
    saved = c.post("/api/v1/plans", json=plan)
    assert saved.status_code == 201
    pid = saved.json()["id"]
    loaded = c.get(f"/api/v1/plans/{pid}").json()["plan"]["income_streams"]
    assert [s["id"] for s in loaded] == [f"s{i}" for i in range(9)]
    assert [s["amount"] for s in loaded] == [f"{(i + 1) * 1000}.00" for i in range(9)]
    total = sum((i + 1) * 1000 for i in range(9))  # 45,000 a month
    assert project(c, plan, 12)["years"][0]["annual_income"] == f"{total * 12}.00"
    streams[3]["label"] = "Renamed"
    assert c.put(f"/api/v1/plans/{pid}", json=base_plan(c, streams, as_of="2027-01")).status_code == 200
    again = c.get(f"/api/v1/plans/{pid}").json()["plan"]["income_streams"]
    assert [s["label"] for s in again].count("Renamed") == 1 and len(again) == 9


def test_step_ups_survive_serialisation_and_reload():
    c = authed_client("inc11")
    plan = base_plan(c, [stream(start=2026, growth="0.050000", steps=[(2028, "60000.00"), (2030, "75000.00")])], as_of="2026-01")
    pid = c.post("/api/v1/plans", json=plan).json()["id"]
    got = c.get(f"/api/v1/plans/{pid}").json()["plan"]["income_streams"][0]
    assert [(s["year"], s["amount"]) for s in got["step_ups"]] == [(2028, "60000.00"), (2030, "75000.00")]
    assert got["annual_growth"] == "0.050000" and got["start_year"] == 2026


def test_legacy_streams_forecast_is_unchanged_and_plan_growth_never_leaks_into_scheduled_streams():
    c = authed_client("inc12")
    legacy = {"id": "old", "label": "Salary", "monthly_net": "100000.00", "ends_after": "2028-06"}
    plan = base_plan(c, [legacy], as_of="2026-10")
    plan["assumptions"]["income_growth_annual"] = "0.050000"
    # Old behaviour, hand-computed: growth steps up on each anniversary of the plan start (month 13, 25),
    # and the stream stops after 2028-06, which is month 21.
    assert monthly_income(plan, 1) == D("100000.00")
    assert monthly_income(plan, 13) == D("105000.00")
    assert monthly_income(plan, 21) == D("105000.00")
    assert monthly_income(plan, 22) == D("0.00")
    mixed = base_plan(c, [legacy, stream("new", amount="10000.00", start=2026)], as_of="2026-10")
    mixed["assumptions"]["income_growth_annual"] = "0.050000"
    assert monthly_income(mixed, 13) == D("105000.00") + D("10000.00")  # the scheduled stream gets no plan-wide growth
    pid = c.post("/api/v1/plans", json=plan).json()["id"]
    back = c.get(f"/api/v1/plans/{pid}").json()["plan"]["income_streams"][0]
    assert (back["id"], back["label"], back["monthly_net"], back["ends_after"], back["start_year"]) == ("old", "Salary", "100000.00", "2028-06", None)


def test_projection_totals_cumulative_and_flows_agree():
    c = authed_client("inc13")
    plan = base_plan(c, [stream("a", start=2026, end=2028, growth="0.050000", steps=[(2028, "60000.00")]), stream("b", amount="30000.00", frequency="quarterly", start=2027)], as_of="2026-10", expenses="20000.00")
    body = project(c, plan, 48)
    years = body["years"]
    running = D(0)
    for row in years:
        running += D(row["annual_income"])
        assert D(row["cumulative_income"]) == running
    assert D(body["total_projected_income"]) == running
    # 48 months from 2026-10 end in 2030-09. Stream a ended in 2028; stream b is 10,000 a month from 2027.
    assert [D(y["annual_income"]) for y in years] == [3 * D("50000"), 12 * (D("52500") + D("10000")), 12 * (D("60000") + D("10000")), 12 * D("10000"), 9 * D("10000")]
    assert years[-1]["months_included"] == 9 and body["plan_source"] == "hypothetical"
    with engine_context():
        f = month_flows(resolve(Plan.model_validate(plan), None), 1)
    assert f.income == D("50000.00") and f.surplus == D("30000.00")  # income minus the 20,000 spending


def test_csv_export_matches_the_projection_and_is_excel_safe():
    c = authed_client("inc14")
    plan = base_plan(c, [stream("a", start=2026, growth="0.050000", label='Pay, "main"')], as_of="2026-10")
    body = project(c, plan, 36)
    r = c.post(URL + "/csv", json={"plan": plan, "horizon_months": 36})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert "arthayukti_income_projection.csv" in r.headers["content-disposition"]
    assert r.content.startswith(b"\xef\xbb\xbf")  # UTF-8 byte-order mark for Excel
    rows = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))
    assert rows[0] == ["Year", "Annual projected income", "Cumulative projected income"]
    assert [(int(y), a, cu) for y, a, cu in rows[1:]] == [(row["year"], row["annual_income"], row["cumulative_income"]) for row in body["years"]]


def test_projection_requires_sign_in_and_saved_plans_belong_to_their_owner():
    c = authed_client("inc15")
    other = authed_client("inc16")
    plan = base_plan(c, [stream(start=2027)], as_of="2027-01")
    pid = c.post("/api/v1/plans", json=plan).json()["id"]
    anon = TestClient(app)
    assert anon.post(URL, json={"plan": plan}).status_code == 401
    assert anon.post(URL + "/csv", json={"plan": plan}).status_code == 401
    assert other.post(URL, json={"plan_id": pid}).status_code == 404
    assert other.post(URL + "/csv", json={"plan_id": pid}).status_code == 404
    saved = c.post(URL, json={"plan_id": pid, "horizon_months": 24}).json()
    assert saved["plan_source"] == "saved" and saved["years"][0]["annual_income"] == "600000.00"
    assert c.post(URL, json={"plan_id": pid, "plan": plan}).status_code == 422
    assert c.post(URL, json={"plan": plan, "horizon_months": 0}).status_code == 422
