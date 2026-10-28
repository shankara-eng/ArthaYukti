"""Holdings ledger over HTTP: recording, replay checks, valuation provenance, reconciliation, export and ownership."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.db.models import InvestmentTransaction, MarketDataSnapshot
from app.db.session import SessionLocal
from app.main import app
from tests.helpers import authed_client

D = Decimal
BASE = "/api/v1/financials/investments"


@pytest.fixture()
def client() -> TestClient:
    return authed_client("ledger")


def holding(client, **extra):
    body = {"asset_name": "Acme Ltd", "asset_type": "stock", "quantity": "1.0000", "purchase_price": "0.00", "current_value": "0.00", **extra}
    response = client.post(BASE, json=body)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def add(client, hid, **body):
    return client.post(f"{BASE}/{hid}/transactions", json=body)


def buy(date="2025-01-10", quantity="100", price="50", fees="100.00"):
    return {"transaction_type": "buy", "trade_date": date, "quantity": quantity, "price": price, "fees": fees}


def store_quote(symbol, age=timedelta(hours=1), currency="INR", price="60.0000"):
    db = SessionLocal()
    try:
        db.add(MarketDataSnapshot(symbol=symbol, asset_type="equity", price=D(price), currency=currency, source="TEST_FEED", fetched_at=datetime.now(UTC) - age, is_stale=False))
        db.commit()
    finally:
        db.close()


def test_every_route_needs_a_sign_in(client):
    hid = holding(client)
    anonymous = TestClient(app)
    assert anonymous.get(f"{BASE}/{hid}/position").status_code == 401
    assert anonymous.post(f"{BASE}/{hid}/transactions", json=buy()).status_code == 401


def test_another_persons_holding_is_not_found_for_every_action(client):
    hid = holding(client)
    tid = add(client, hid, **buy()).json()["id"]
    other = authed_client("other")
    assert other.get(f"{BASE}/{hid}/position").status_code == 404
    assert other.get(f"{BASE}/{hid}/transactions").status_code == 404
    assert other.post(f"{BASE}/{hid}/transactions", json=buy()).status_code == 404
    assert other.delete(f"{BASE}/{hid}/transactions/{tid}").status_code == 404
    assert other.post(f"{BASE}/{hid}/apply-ledger").status_code == 404
    assert other.get(f"{BASE}/{hid}/ledger.csv").status_code == 404


def test_the_hand_checked_history_reconciles_over_the_api(client):
    hid = holding(client, symbol=None)
    steps = [
        buy("2025-01-10", "100", "50", "100.00"),
        buy("2025-03-01", "50", "60", "50.00"),
        {"transaction_type": "split", "trade_date": "2025-04-01", "ratio_new": 2, "ratio_old": 1},
        {"transaction_type": "dividend", "trade_date": "2025-05-01", "price": "2", "fees": "60.00"},
        {"transaction_type": "bonus", "trade_date": "2025-06-01", "ratio_new": 1, "ratio_old": 10},
        {"transaction_type": "sell", "trade_date": "2025-07-01", "quantity": "250", "price": "40", "fees": "80.00"},
    ]
    for step in steps:
        assert add(client, hid, **step).status_code == 201
    pos = client.get(f"{BASE}/{hid}/position").json()
    assert (pos["quantity"], pos["cost_basis"], pos["realised_gain"]) == ("80.000000", "1525.00", "3295.00")
    assert pos["average_cost"] == "19.0625" and pos["dividends_net"] == "540.00" and pos["fees_paid"] == "230.00"
    assert [s["days_held"] for s in pos["sales"]] == [172, 122]
    rows = client.get(f"{BASE}/{hid}/transactions").json()
    assert [r["transaction_type"] for r in rows] == ["buy", "buy", "split", "dividend", "bonus", "sell"]
    assert rows[-1]["quantity_after"] == "80.000000" and rows[-1]["realised_gain"] == "3295.00" and rows[-1]["cash"] == "9920.00"


def test_a_back_dated_entry_is_replayed_in_date_order(client):
    hid = holding(client)
    add(client, hid, **buy("2025-03-01", "10", "10", "0.00"))
    add(client, hid, **buy("2025-01-01", "5", "10", "0.00"))  # recorded later, happened earlier
    rows = client.get(f"{BASE}/{hid}/transactions").json()
    assert [r["trade_date"] for r in rows] == ["2025-01-01", "2025-03-01"] and rows[1]["quantity_after"] == "15.000000"


def test_a_sale_of_units_not_held_is_refused_and_nothing_is_saved(client):
    hid = holding(client)
    add(client, hid, **buy(quantity="10"))
    response = add(client, hid, transaction_type="sell", trade_date="2025-02-01", quantity="11", price="5")
    assert response.status_code == 422 and response.json()["error"]["code"] == "ledger_invalid"
    assert "hold 10" in response.json()["error"]["message"]
    assert len(client.get(f"{BASE}/{hid}/transactions").json()) == 1


def test_a_back_dated_sale_before_the_purchase_is_refused(client):
    hid = holding(client)
    add(client, hid, **buy("2025-03-01", "10"))
    assert add(client, hid, transaction_type="sell", trade_date="2025-01-01", quantity="1", price="5").status_code == 422


def test_deleting_a_purchase_that_later_sales_depend_on_is_refused(client):
    hid = holding(client)
    bought = add(client, hid, **buy(quantity="10")).json()["id"]
    sold = add(client, hid, transaction_type="sell", trade_date="2025-02-01", quantity="4", price="9").json()["id"]
    refused = client.delete(f"{BASE}/{hid}/transactions/{bought}")
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "ledger_conflict"
    assert client.delete(f"{BASE}/{hid}/transactions/{sold}").status_code == 204
    assert client.delete(f"{BASE}/{hid}/transactions/{bought}").status_code == 204
    assert client.get(f"{BASE}/{hid}/transactions").json() == []


@pytest.mark.parametrize(
    "body",
    [
        {"transaction_type": "buy", "trade_date": "2025-01-01", "price": "5"},  # no quantity
        {"transaction_type": "sell", "trade_date": "2025-01-01", "quantity": "1"},  # no price
        {"transaction_type": "buy", "trade_date": "2025-01-01", "quantity": "1", "price": "5", "ratio_new": 2, "ratio_old": 1},
        {"transaction_type": "split", "trade_date": "2025-01-01", "ratio_new": 2},  # half a ratio
        {"transaction_type": "split", "trade_date": "2025-01-01", "ratio_new": 2, "ratio_old": 2},  # changes nothing
        {"transaction_type": "bonus", "trade_date": "2025-01-01", "ratio_new": 1, "ratio_old": 1, "quantity": "1"},
        {"transaction_type": "dividend", "trade_date": "2025-01-01", "quantity": "5", "price": "1"},
        {"transaction_type": "buy", "trade_date": "2025-02-30", "quantity": "1", "price": "5"},  # not a real date
        {"transaction_type": "buy", "trade_date": "2025-01-01", "quantity": "0", "price": "5"},
        {"transaction_type": "buy", "trade_date": "2025-01-01", "quantity": "1", "price": "-5"},
        {"transaction_type": "buy", "trade_date": "2025-01-01", "quantity": 1, "price": "5"},  # a JSON number, not a decimal string
        {"transaction_type": "swap", "trade_date": "2025-01-01"},
    ],
)
def test_malformed_transactions_are_refused(client, body):
    hid = holding(client)
    assert add(client, hid, **body).status_code == 422
    assert client.get(f"{BASE}/{hid}/transactions").json() == []


def test_a_future_dated_transaction_is_refused_because_it_is_a_plan_not_a_record(client):
    hid = holding(client)
    tomorrow = (datetime.now(UTC) + timedelta(days=2)).strftime("%Y-%m-%d")
    assert add(client, hid, **buy(date=tomorrow)).status_code == 422


def test_valuation_says_where_its_figure_comes_from(client):
    # No symbol and no entered value: no valuation, and no unrealised gain is invented.
    hid = holding(client)
    add(client, hid, **buy(quantity="10", price="50", fees="0.00"))
    assert client.get(f"{BASE}/{hid}/position").json()["valuation"]["status"] == "unavailable"
    # A value the person entered is used, and said to be theirs.
    manual = holding(client, current_value="900.00", last_valuation_date="2025-02-01")
    add(client, manual, **buy(quantity="10", price="50", fees="0.00"))
    v = client.get(f"{BASE}/{manual}/position").json()["valuation"]
    assert (v["basis"], v["status"], v["value"], v["unrealised_gain"]) == ("manual", "manual", "900.00", "400.00")


def test_a_stored_price_values_the_units_and_a_stale_one_is_called_stale(client):
    store_quote("LDGR1", price="60.0000")
    fresh = holding(client, symbol="LDGR1", current_value="1.00")
    add(client, fresh, **buy(quantity="10", price="50", fees="0.00"))
    v = client.get(f"{BASE}/{fresh}/position").json()["valuation"]
    # 10 units at the stored 60 = 600; cost 500; unrealised +100. The entered value of 1.00 is not used.
    assert (v["basis"], v["status"], v["value"], v["unit_price"], v["unrealised_gain"]) == ("market_snapshot", "fresh", "600.00", "60.0000", "100.00")
    store_quote("LDGR2", age=timedelta(days=3), price="40.0000")
    stale = holding(client, symbol="LDGR2")
    add(client, stale, **buy(quantity="10", price="50", fees="0.00"))
    v = client.get(f"{BASE}/{stale}/position").json()["valuation"]
    assert v["status"] == "stale" and v["value"] == "400.00" and "old" in v["message"]


def test_a_price_in_another_currency_is_not_used_to_value_rupee_holdings(client):
    store_quote("LDGR3", currency="USD", price="10.0000")
    hid = holding(client, symbol="LDGR3", current_value="777.00")
    add(client, hid, **buy(quantity="10", price="50", fees="0.00"))
    v = client.get(f"{BASE}/{hid}/position").json()["valuation"]
    assert v["status"] == "currency_mismatch" and v["value"] is None and v["unrealised_gain"] is None


def test_reconciliation_compares_the_ledger_with_the_holding_record_and_changes_nothing(client):
    hid = holding(client, quantity="1.0000", current_value="800.00")
    add(client, hid, **buy(quantity="10", price="50", fees="0.00"))
    rec = client.get(f"{BASE}/{hid}/position").json()["reconciliation"]
    assert rec == {"has_ledger": True, "record_quantity": "1.0000", "ledger_quantity": "10.000000", "matches": False, "difference": "9.000000"}
    still = next(h for h in client.get(BASE).json() if h["id"] == hid)
    assert still["quantity"] == "1.0000" and still["current_value"] == "800.00"  # reading never edits the record


def test_with_no_transactions_there_is_nothing_to_reconcile_or_apply(client):
    hid = holding(client)
    pos = client.get(f"{BASE}/{hid}/position").json()
    assert pos["reconciliation"]["has_ledger"] is False and D(pos["quantity"]) == 0 and pos["reconciliation"]["matches"] is False
    assert client.post(f"{BASE}/{hid}/apply-ledger").status_code == 409


def test_applying_the_ledger_sets_units_and_cost_and_never_the_entered_value(client):
    hid = holding(client, quantity="1.0000", purchase_price="1.00", current_value="800.00")
    add(client, hid, **buy(quantity="10", price="50", fees="0.00"))
    result = client.post(f"{BASE}/{hid}/apply-ledger").json()
    assert result["quantity"] == "10.0000" and result["purchase_price"] == "500.00"
    record = next(h for h in client.get(BASE).json() if h["id"] == hid)
    assert (record["quantity"], record["purchase_price"], record["current_value"]) == ("10.0000", "500.00", "800.00")
    assert client.get(f"{BASE}/{hid}/position").json()["reconciliation"]["matches"] is True


def test_the_csv_carries_the_running_position_and_opens_in_excel(client):
    hid = holding(client)
    add(client, hid, **buy("2025-01-10", "100", "50", "100.00"))
    add(client, hid, transaction_type="split", trade_date="2025-02-01", ratio_new=2, ratio_old=1)
    response = client.get(f"{BASE}/{hid}/ledger.csv")
    assert response.status_code == 200 and response.headers["content-type"].startswith("text/csv")
    text = response.content.decode("utf-8")
    assert text.startswith("﻿")
    rows = [r.split(",") for r in text.lstrip("﻿").strip().split("\r\n")]
    assert rows[0][:2] == ["Date", "Type"] and len(rows) == 3
    assert rows[1][6] == "100.000000" and rows[1][7] == "5100.00" and rows[1][9] == "-5100.00"
    assert rows[2][5] == "2:1" and rows[2][6] == "200.000000" and rows[2][7] == "5100.00"


def test_the_data_export_includes_the_ledger_and_deleting_the_account_removes_it(client):
    hid = holding(client)
    add(client, hid, **buy())
    exported = client.get("/api/v1/auth/export-data").json()
    assert len(exported["investment_transactions"]) == 1 and exported["investment_transactions"][0]["holding_id"] == hid
    assert client.delete("/api/v1/auth/delete-account").status_code == 200
    db = SessionLocal()
    try:
        assert db.query(InvestmentTransaction).filter(InvestmentTransaction.holding_id == hid).count() == 0
    finally:
        db.close()


def test_deleting_a_holding_removes_its_transactions(client):
    hid = holding(client)
    add(client, hid, **buy())
    assert client.delete(f"{BASE}/{hid}").status_code == 204
    db = SessionLocal()
    try:
        assert db.query(InvestmentTransaction).filter(InvestmentTransaction.holding_id == hid).count() == 0
    finally:
        db.close()


def test_a_holding_carries_a_bounded_number_of_transactions(client, monkeypatch):
    from app.api import ledger

    monkeypatch.setattr(ledger, "MAX_TRANSACTIONS_PER_HOLDING", 2)
    hid = holding(client)
    assert add(client, hid, **buy("2025-01-01", "1", "5", "0.00")).status_code == 201
    assert add(client, hid, **buy("2025-01-02", "1", "5", "0.00")).status_code == 201
    refused = add(client, hid, **buy("2025-01-03", "1", "5", "0.00"))
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "ledger_full"
    assert len(client.get(f"{BASE}/{hid}/transactions").json()) == 2
