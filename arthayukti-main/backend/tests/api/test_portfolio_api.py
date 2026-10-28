"""The stock portfolio over HTTP, with the price provider mocked: nothing here depends on a live market service."""

import subprocess
import sys
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.adapters import stock_provider as sp
from app.db.models import MarketDataSnapshot, PortfolioSnapshot
from app.db.session import SessionLocal
from app.main import app
from tests.helpers import authed_client

D = Decimal
BASE = "/api/v1/portfolio"
BACKEND = Path(__file__).resolve().parents[2]


class Market:
    """A stand-in for the price service. Change `prices` and `mode` between requests."""

    def __init__(self):
        self.prices: dict[str, object] = {}
        self.mode = "ok"  # ok | down | malformed | slow
        self.calls: list[tuple[str, dict]] = []
        self.search_results = [{"symbol": "RELIANCE", "company_name": "Reliance Industries"}, {"symbol": "TCS", "company_name": "Tata Consultancy"}]

    def __call__(self, path, params):
        self.calls.append((path, dict(params)))
        if self.mode == "down":
            raise sp.ProviderError("unavailable", "The price service could not be reached.")
        if self.mode == "slow":
            raise sp.ProviderError("timeout", "The price service did not answer in time.")
        if self.mode == "malformed":
            return 200, {"unexpected": True}
        if path == "/search":
            return 200, {"status": "success", "results": self.search_results}
        stocks = []
        for ticker in params["symbols"].split(","):
            price = self.prices.get(ticker)
            if price is None:
                stocks.append({"symbol": ticker[:-3], "exchange": "NSE", "ticker": ticker, "error": "No data available"})
            else:
                stocks.append({"symbol": ticker[:-3], "exchange": "NSE" if ticker.endswith(".NS") else "BSE", "ticker": ticker, "company_name": f"{ticker[:-3].title()} Ltd", "last_price": price})
        return 200, {"status": "success", "stocks": stocks}


def _clear_stored_prices():
    """Market prices are shared, public rows (one per ticker). Start every test with none, in the throwaway database."""
    db = SessionLocal()
    try:
        db.query(MarketDataSnapshot).delete()
        db.commit()
    finally:
        db.close()


@pytest.fixture()
def market(monkeypatch):
    sp.reset_for_tests()
    _clear_stored_prices()
    fake = Market()
    monkeypatch.setattr(sp, "_http_get", fake)
    yield fake
    sp.reset_for_tests()


@pytest.fixture()
def client(market) -> TestClient:
    return authed_client("portfolio")


def add(client, symbol="RELIANCE", exchange="NSE", quantity="10", price="1000", date="2026-01-05", **extra):
    body = {"symbol": symbol, "exchange": exchange, "quantity": quantity, "average_price": price, "purchase_date": date, **extra}
    return client.post(f"{BASE}/holdings", json=body)


def holdings(client):
    return client.get(BASE).json()["holdings"]


# ---- access ----------------------------------------------------------------------------------------------------------


def test_every_route_needs_a_sign_in(client):
    anonymous = TestClient(app)
    hid = add(client).json()["id"]
    for method, path, body in [
        ("get", BASE, None),
        ("post", f"{BASE}/refresh", None),
        ("get", f"{BASE}/search?q=tata", None),
        ("get", f"{BASE}/history", None),
        ("post", f"{BASE}/holdings", {"symbol": "TCS", "exchange": "NSE", "quantity": "1", "average_price": "1"}),
        ("put", f"{BASE}/holdings/{hid}", {"quantity": "2"}),
        ("delete", f"{BASE}/holdings/{hid}", None),
    ]:
        response = getattr(anonymous, method)(path, **({"json": body} if body is not None else {}))
        assert response.status_code == 401, (method, path)


def test_another_persons_holdings_are_invisible_and_untouchable(client, market):
    hid = add(client).json()["id"]
    other = authed_client("portfolio-other")
    assert other.get(BASE).json()["holdings"] == []
    assert other.put(f"{BASE}/holdings/{hid}", json={"quantity": "99"}).status_code == 404
    assert other.delete(f"{BASE}/holdings/{hid}").status_code == 404
    assert holdings(client)[0]["quantity"] == "10.000000"  # not changed, still there
    market.prices["RELIANCE.NS"] = 1200
    other.post(f"{BASE}/refresh")
    assert other.get(f"{BASE}/history").json()["snapshots"] == []  # no readings of their own, none of mine
    assert other.get(f"{BASE}/history").json()["invested_timeline"] == []


# ---- add, list, edit, delete -----------------------------------------------------------------------------------------------


def test_add_list_edit_and_delete_a_holding(client, market):
    market.prices["RELIANCE.NS"] = 1200
    created = add(client, company_name="Reliance Industries")
    assert created.status_code == 201
    body = created.json()
    assert body["ticker"] == "RELIANCE.NS" and body["merged"] is False and body["verified"] is True
    row = holdings(client)[0]
    assert (row["symbol"], row["exchange"], row["company_name"], row["quantity"], row["purchase_date"], row["purchase_date_entered"]) == ("RELIANCE", "NSE", "Reliance Industries", "10.000000", "2026-01-05", True)
    assert (row["average_cost"], row["invested"], row["editable"]) == ("1000.0000", "10000.00", True)

    edited = client.put(f"{BASE}/holdings/{body['id']}", json={"quantity": "20", "average_price": "900.50", "purchase_date": "2026-02-01"})
    assert edited.status_code == 200
    row = holdings(client)[0]
    assert (row["quantity"], row["average_cost"], row["invested"], row["purchase_date"]) == ("20.000000", "900.5000", "18010.00", "2026-02-01")

    assert client.delete(f"{BASE}/holdings/{body['id']}").status_code == 204
    assert holdings(client) == []
    assert client.delete(f"{BASE}/holdings/{body['id']}").status_code == 404


def test_the_same_stock_on_two_exchanges_is_two_holdings(client):
    add(client, exchange="NSE")
    add(client, exchange="BSE")
    assert sorted(h["ticker"] for h in holdings(client)) == ["RELIANCE.BO", "RELIANCE.NS"]


def test_buying_the_same_stock_again_adds_a_purchase_and_the_average_follows(client):
    first = add(client, quantity="10", price="1000", date="2026-01-05").json()
    second = add(client, quantity="10", price="1200", date="2026-03-05").json()
    assert second["id"] == first["id"] and second["merged"] is True
    row = holdings(client)[0]
    assert (row["quantity"], row["invested"], row["average_cost"]) == ("20.000000", "22000.00", "1100.0000")  # (10 x 1000 + 10 x 1200) / 20
    assert row["editable"] is False
    blocked = client.put(f"{BASE}/holdings/{first['id']}", json={"quantity": "5"})
    assert blocked.status_code == 409 and blocked.json()["error"]["code"] == "several_transactions"


def test_a_missing_purchase_date_is_not_invented_as_a_real_one(client):
    body = {"symbol": "TCS", "exchange": "NSE", "quantity": "5", "average_price": "3000"}
    assert client.post(f"{BASE}/holdings", json=body).status_code == 201
    row = holdings(client)[0]
    assert row["purchase_date_entered"] is False and row["purchase_date"] == datetime.now(UTC).strftime("%Y-%m-%d")


# ---- validation --------------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "change",
    [
        {"symbol": "RELIANCE.NS"},
        {"symbol": ""},
        {"symbol": "bad symbol"},
        {"symbol": "A" * 21},
        {"symbol": "X;DROP"},
        {"exchange": "NYSE"},
        {"exchange": "nse"},
        {"quantity": "0"},
        {"quantity": "-3"},
        {"quantity": "1.5"},
        {"quantity": "1000000001"},
        {"quantity": "abc"},
        {"quantity": 10},  # a JSON number: money and quantities are strings
        {"average_price": "0"},
        {"average_price": "-1"},
        {"average_price": 100.5},
        {"average_price": "10000001"},
        {"average_price": "1.23456"},
        {"purchase_date": "2999-01-01"},
        {"purchase_date": "1980-01-01"},
        {"purchase_date": "2026-13-45"},
        {"purchase_date": "05/01/2026"},
        {"current_price": "5"},  # a price from the browser is not accepted at all
        {"market_value": "999999"},
        {"user_id": "someone-else"},
    ],
)
def test_invalid_input_is_refused_and_nothing_is_saved(client, change):
    body = {"symbol": "RELIANCE", "exchange": "NSE", "quantity": "10", "average_price": "1000", "purchase_date": "2026-01-05", **change}
    response = client.post(f"{BASE}/holdings", json=body)
    assert response.status_code == 422, response.text
    assert holdings(client) == []


def test_symbols_are_uppercased_and_the_unit_price_may_have_paise(client):
    assert add(client, symbol=" tcs ", quantity="3", price="3500.75").status_code == 201
    row = holdings(client)[0]
    assert row["symbol"] == "TCS" and row["invested"] == "10502.25"  # 3 x 3500.75


def test_an_edit_must_change_something_and_is_validated(client):
    hid = add(client).json()["id"]
    for bad in [{}, {"quantity": "0"}, {"average_price": "-1"}, {"purchase_date": "2999-01-01"}, {"price": "5"}]:
        assert client.put(f"{BASE}/holdings/{hid}", json=bad).status_code == 422
    assert holdings(client)[0]["quantity"] == "10.000000"


# ---- valuation and profit or loss ------------------------------------------------------------------------------------------------


def test_prices_are_fetched_by_the_server_and_profit_and_loss_follow_the_formulas(client, market):
    add(client, symbol="RELIANCE", quantity="10", price="1000")  # 10,000 in
    add(client, symbol="TCS", quantity="5", price="3000")  # 15,000 in
    market.prices.update({"RELIANCE.NS": 1200, "TCS.NS": "2700.5"})
    body = client.post(f"{BASE}/refresh").json()
    assert body["refresh"] == {"status": "ok", "requested": 2, "updated": 2, "error_code": None, "message": None}
    by = {h["symbol"]: h for h in body["holdings"]}
    assert (by["RELIANCE"]["price"], by["RELIANCE"]["market_value"], by["RELIANCE"]["unrealised"], by["RELIANCE"]["unrealised_pct"]) == ("1200.0000", "12000.00", "2000.00", "20.00")
    assert (by["TCS"]["price"], by["TCS"]["market_value"], by["TCS"]["unrealised"], by["TCS"]["unrealised_pct"]) == ("2700.5000", "13502.50", "-1497.50", "-9.98")
    t = body["totals"]
    # Invested 25,000. Value 12,000 + 13,502.50 = 25,502.50. Gain 502.50 = 2.01% of 25,000 (not the average of +20 and -9.98).
    assert (t["invested_priced"], t["value"], t["unrealised"], t["unrealised_pct"]) == ("25000.00", "25502.50", "502.50", "2.01")
    assert t["complete"] is True and t["priced_positions"] == 2 and body["latest_price_at"] is not None
    assert [w["weight_pct"] for w in (by["RELIANCE"], by["TCS"])] == ["47.05", "52.95"]  # 12000 and 13502.50 over 25502.50
    assert body["disclaimer"].startswith("Prices come from a free third-party service")
    # The provider was asked only for the two symbols, in one call.
    call = [c for c in market.calls if c[0] == "/stock/list"][-1]
    assert call[1] == {"symbols": "RELIANCE.NS,TCS.NS", "res": "num"}


def test_reading_the_portfolio_does_not_call_the_provider(client, market):
    add(client)
    n = len(market.calls)
    client.get(BASE)
    assert len(market.calls) == n


def test_realised_profit_comes_from_sales_and_is_not_counted_in_unrealised(client, market):
    hid = add(client, quantity="100", price="50", date="2026-01-05").json()["id"]
    sell = client.post(f"/api/v1/financials/investments/{hid}/transactions", json={"transaction_type": "sell", "trade_date": "2026-02-05", "quantity": "40", "price": "70", "fees": "0"})
    assert sell.status_code == 201, sell.text
    market.prices["RELIANCE.NS"] = 65
    body = client.post(f"{BASE}/refresh").json()
    row, t = body["holdings"][0], body["totals"]
    assert (row["quantity"], row["invested"], row["market_value"], row["unrealised"], row["realised"]) == ("60.000000", "3000.00", "3900.00", "900.00", "800.00")
    assert t["total_profit"] == "1700.00" and t["total_return_pct"] == "34.00"  # 900 + 800 over the 5000 originally paid


def test_a_fully_sold_holding_is_closed_with_its_realised_profit(client, market):
    hid = add(client, quantity="10", price="100").json()["id"]
    client.post(f"/api/v1/financials/investments/{hid}/transactions", json={"transaction_type": "sell", "trade_date": "2026-02-05", "quantity": "10", "price": "150", "fees": "0"})
    market.prices["RELIANCE.NS"] = 999
    asked = len([c for c in market.calls if c[0] == "/stock/list"])
    body = client.post(f"{BASE}/refresh").json()
    row = body["holdings"][0]
    assert row["closed"] is True and row["market_value"] == "0.00" and row["realised"] == "500.00"
    assert body["totals"]["open_positions"] == 0 and body["totals"]["realised"] == "500.00"
    assert len([c for c in market.calls if c[0] == "/stock/list"]) == asked  # no price is asked for a closed position


def test_a_refresh_also_keeps_net_worth_in_step(client, market):
    add(client, quantity="10", price="1000")
    market.prices["RELIANCE.NS"] = 1250
    client.post(f"{BASE}/refresh")
    assert client.get("/api/v1/financials/net-worth").json()["total_assets"] == "12500.00"


# ---- missing, stale and unavailable prices ------------------------------------------------------------------------------------------


def test_with_no_price_yet_nothing_is_valued_and_nothing_is_zero(client, market):
    market.mode = "down"
    saved = add(client).json()
    assert saved["verified"] is False and "could not be reached" in saved["message"]
    body = client.get(BASE).json()
    row, t = body["holdings"][0], body["totals"]
    assert (row["price"], row["price_status"], row["market_value"], row["unrealised"], row["unrealised_pct"], row["price_fetched_at"]) == (None, "unavailable", None, None, None, None)
    assert (t["priced_positions"], t["unpriced_positions"], t["value"], t["unrealised_pct"], t["complete"]) == (0, 1, "0.00", None, False)
    assert t["invested_unpriced"] == "10000.00"  # what was put in is still shown


@pytest.mark.parametrize("mode,code", [("down", "unavailable"), ("slow", "timeout"), ("malformed", "bad_response")])
def test_a_provider_failure_keeps_the_last_prices_and_says_so(client, market, mode, code):
    add(client)
    market.prices["RELIANCE.NS"] = 1100
    assert client.post(f"{BASE}/refresh").json()["refresh"]["status"] == "ok"
    sp.reset_for_tests()
    market.mode = mode
    body = client.post(f"{BASE}/refresh")
    assert body.status_code == 200
    info = body.json()
    assert info["refresh"]["status"] == "failed" and info["refresh"]["error_code"] == code and info["refresh"]["updated"] == 0
    row = info["holdings"][0]
    assert row["price"] == "1100.0000" and row["price_status"] == "fresh" and row["market_value"] == "11000.00"  # the last good price, not zero
    assert row["price_fetched_at"] is not None


def test_a_price_older_than_a_day_is_shown_but_marked_stale(client, market):
    add(client)
    db = SessionLocal()
    try:
        db.add(MarketDataSnapshot(symbol="RELIANCE.NS", asset_type="equity", price=D("1300.00"), currency="INR", source=sp.SOURCE_NAME, fetched_at=datetime.now(UTC) - timedelta(days=3), is_stale=False))
        db.commit()
    finally:
        db.close()
    row = holdings(client)[0]
    assert row["price"] == "1300.0000" and row["price_status"] == "stale" and row["market_value"] == "13000.00"


def test_a_symbol_the_provider_has_no_price_for_is_partial_and_unavailable(client, market):
    add(client, symbol="RELIANCE")
    add(client, symbol="NOSUCH")
    market.prices["RELIANCE.NS"] = 1200
    body = client.post(f"{BASE}/refresh").json()
    assert body["refresh"]["status"] == "partial" and body["refresh"]["updated"] == 1
    by = {h["symbol"]: h for h in body["holdings"]}
    assert by["NOSUCH"]["price_status"] == "unavailable" and by["NOSUCH"]["market_value"] is None
    assert body["totals"]["value"] == "12000.00" and body["totals"]["unpriced_positions"] == 1 and body["totals"]["complete"] is False


@pytest.mark.parametrize("bad", ["N/A", 0, -1, None, "nan", 1e15])
def test_a_nonsense_price_is_never_stored_as_a_price(client, market, bad):
    add(client)
    market.prices["RELIANCE.NS"] = bad
    market.prices = {k: v for k, v in market.prices.items() if v is not None}
    body = client.post(f"{BASE}/refresh").json()
    assert body["holdings"][0]["price"] is None and body["holdings"][0]["market_value"] is None


def test_adding_a_symbol_the_provider_does_not_know_still_saves_it_with_a_warning(client, market):
    saved = add(client, symbol="NOSUCH").json()
    assert saved["verified"] is False and "no price" in saved["message"]
    assert len(holdings(client)) == 1


def test_stock_holdings_that_cannot_be_priced_are_listed_as_excluded_not_dropped(client):
    made = client.post("/api/v1/financials/investments", json={"asset_name": "Old paper", "asset_type": "stock", "quantity": "1.0000", "purchase_price": "100.00", "current_value": "100.00"})
    nosym = made.json()["id"]
    sym = client.post("/api/v1/financials/investments", json={"asset_name": "Typed in", "asset_type": "stock", "symbol": "TCS.NS", "quantity": "1.0000", "purchase_price": "100.00", "current_value": "100.00"}).json()["id"]
    body = client.get(BASE).json()
    assert body["holdings"] == []
    reasons = {e["id"]: e["reason"] for e in body["excluded"]}
    assert "no NSE or BSE symbol" in reasons[nosym] and "No purchase is recorded" in reasons[sym]
    assert client.delete(f"{BASE}/holdings/{nosym}").status_code == 204  # still removable here


def test_other_kinds_of_holding_are_not_reachable_through_the_portfolio(client):
    gold = client.post("/api/v1/financials/investments", json={"asset_name": "Gold", "asset_type": "gold", "quantity": "1.0000", "purchase_price": "1.00", "current_value": "1.00"}).json()["id"]
    assert client.put(f"{BASE}/holdings/{gold}", json={"quantity": "2"}).status_code == 404
    assert client.delete(f"{BASE}/holdings/{gold}").status_code == 404


# ---- search ------------------------------------------------------------------------------------------------------------------------


def test_search_offers_both_exchanges_for_each_symbol(client, market):
    body = client.get(f"{BASE}/search", params={"q": "reliance"}).json()
    assert body["results"][0] == {"symbol": "RELIANCE", "company_name": "Reliance Industries", "tickers": [{"exchange": "NSE", "ticker": "RELIANCE.NS"}, {"exchange": "BSE", "ticker": "RELIANCE.BO"}]}
    assert market.calls[-1] == ("/search", {"q": "reliance"})


@pytest.mark.parametrize("mode,status,code", [("down", 502, "market_unavailable"), ("slow", 504, "market_timeout"), ("malformed", 502, "market_bad_response")])
def test_a_search_failure_is_an_error_not_an_empty_list(client, market, mode, status, code):
    market.mode = mode
    response = client.get(f"{BASE}/search", params={"q": "tata"})
    assert response.status_code == status and response.json()["error"]["code"] == code


def test_search_input_is_bounded(client):
    assert client.get(f"{BASE}/search", params={"q": "a"}).status_code == 422
    assert client.get(f"{BASE}/search", params={"q": "x" * 41}).status_code == 422


# ---- history ------------------------------------------------------------------------------------------------------------------------


def test_the_invested_history_comes_from_dated_purchases_without_any_price(client):
    add(client, symbol="RELIANCE", quantity="10", price="1000", date="2026-01-05")
    add(client, symbol="TCS", quantity="5", price="3000", date="2026-02-10")
    body = client.get(f"{BASE}/history").json()
    assert body["invested_timeline"] == [{"date": "2026-01-05", "invested": "10000.00"}, {"date": "2026-02-10", "invested": "25000.00"}]
    assert body["snapshots"] == [] and body["since"] is None  # no value history is invented
    assert "Earlier prices are not available" in body["note"]


def test_value_readings_start_with_the_first_refresh_and_one_replaces_another_the_same_day(client, market):
    add(client)
    market.prices["RELIANCE.NS"] = 1100
    client.post(f"{BASE}/refresh")
    sp.reset_for_tests()
    market.prices["RELIANCE.NS"] = 1150
    client.post(f"{BASE}/refresh")
    body = client.get(f"{BASE}/history").json()
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    assert body["since"] == today
    assert body["snapshots"] == [{"date": today, "market_value": "11500.00", "invested": "10000.00", "complete": True}]  # the later reading that day


def test_a_reading_with_a_missing_price_is_marked_incomplete(client, market):
    add(client, symbol="RELIANCE")
    add(client, symbol="NOSUCH")
    market.prices["RELIANCE.NS"] = 1200
    client.post(f"{BASE}/refresh")
    snap = client.get(f"{BASE}/history").json()["snapshots"][0]
    assert snap["complete"] is False and snap["market_value"] == "12000.00" and snap["invested"] == "10000.00"  # only the priced position is in both


def test_a_failed_refresh_records_no_reading(client, market):
    add(client)
    market.mode = "down"
    client.post(f"{BASE}/refresh")
    assert client.get(f"{BASE}/history").json()["snapshots"] == []


def test_history_ranges_filter_and_unknown_ranges_are_refused(client, market):
    add(client)
    market.prices["RELIANCE.NS"] = 1100
    client.post(f"{BASE}/refresh")
    db = SessionLocal()
    try:
        me = client.get("/api/v1/auth/me").json()["id"]
        db.add(PortfolioSnapshot(user_id=me, snapshot_date="2020-01-01", market_value=D("1.00"), invested=D("1.00"), priced_count=1, holding_count=1, complete=True))
        db.commit()
    finally:
        db.close()
    assert len(client.get(f"{BASE}/history", params={"range": "all"}).json()["snapshots"]) == 2
    one = client.get(f"{BASE}/history", params={"range": "1m"}).json()
    assert len(one["snapshots"]) == 1 and one["since"] == "2020-01-01"
    assert client.get(f"{BASE}/history", params={"range": "10y"}).status_code == 422


# ---- refresh limits and persistence ----------------------------------------------------------------------------------------------


def test_refresh_with_no_holdings_does_not_call_the_provider(client, market):
    body = client.post(f"{BASE}/refresh").json()
    assert body["refresh"] == {"status": "ok", "requested": 0, "updated": 0, "error_code": None, "message": None}
    assert not [c for c in market.calls if c[0] == "/stock/list"]


def test_holdings_and_readings_survive_a_backend_restart(client, market):
    add(client, quantity="10", price="1000")
    market.prices["RELIANCE.NS"] = 1100
    client.post(f"{BASE}/refresh")
    code = (
        "from app.db.session import SessionLocal\n"
        "from app.db.models import AssetInvestment, InvestmentTransaction, PortfolioSnapshot, MarketDataSnapshot\n"
        "db = SessionLocal()\n"
        "h = db.query(AssetInvestment).filter(AssetInvestment.symbol == 'RELIANCE.NS').count()\n"
        "t = db.query(InvestmentTransaction).count()\n"
        "s = db.query(PortfolioSnapshot).count()\n"
        "q = db.query(MarketDataSnapshot).filter(MarketDataSnapshot.symbol == 'RELIANCE.NS').count()\n"
        "print(h, t, s, q)\n"
    )
    # A separate process opens the same database file, as a restarted server would.
    out = subprocess.run([sys.executable, "-c", code], cwd=BACKEND, capture_output=True, text=True, timeout=120, check=True)
    h, t, s, q = (int(x) for x in out.stdout.split()[-4:])
    assert h >= 1 and t >= 1 and s >= 1 and q == 1
    # And the running app reads the same rows back.
    assert holdings(client)[0]["price"] == "1100.0000"
