"""The price-provider client: strict reading of answers, caching, backoff, and the real HTTP layer (against a local server)."""

import json
import threading
import time
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from app.adapters import stock_provider as sp
from app.config import settings

D = Decimal


@pytest.fixture(autouse=True)
def clean():
    sp.reset_for_tests()
    yield
    sp.reset_for_tests()


def stock(ticker, price, name="Acme Ltd", **extra):
    return {"symbol": ticker[:-3], "exchange": "NSE" if ticker.endswith(".NS") else "BSE", "ticker": ticker, "company_name": name, "last_price": price, **extra}


def serve(monkeypatch, handler):
    calls = []

    def fake(path, params):
        calls.append((path, dict(params)))
        return handler(path, params)

    monkeypatch.setattr(sp, "_http_get", fake)
    return calls


def listing(*stocks):
    return (200, {"status": "success", "response_format": "numeric_only", "count": len(stocks), "stocks": list(stocks), "timestamp": "2026-10-28 09:00:00"})


# ---- symbols ------------------------------------------------------------------------------------------------------


def test_tickers_are_exchange_specific_and_validated():
    assert sp.make_ticker("reliance", "NSE") == "RELIANCE.NS"
    assert sp.make_ticker(" m&m ", "BSE") == "M&M.BO"
    assert sp.make_ticker("BAJAJ-AUTO", "NSE") == "BAJAJ-AUTO.NS"
    for bad in ["", "RELIANCE.NS", "has space", "A" * 21, "-X", "A/B", "A;B", "../x"]:
        with pytest.raises(ValueError):
            sp.make_ticker(bad, "NSE")
    with pytest.raises(ValueError):
        sp.make_ticker("TCS", "NYSE")
    assert sp.split_ticker("TCS.BO") == ("TCS", "BSE")
    for bad in ["TCS", "TCS.NSE", "tcs.ns", "TCS.NS;DROP"]:
        with pytest.raises(ValueError):
            sp.split_ticker(bad)


# ---- quotes -------------------------------------------------------------------------------------------------------


def test_a_batch_is_one_call_and_prices_are_read_exactly(monkeypatch):
    calls = serve(monkeypatch, lambda p, q: listing(stock("TCS.NS", 3500.5), stock("INFY.BO", "1500.25", "Infosys")))
    out = sp.fetch_quotes(["TCS.NS", "INFY.BO"])
    assert out["TCS.NS"].price == D("3500.50") and out["TCS.NS"].exchange == "NSE" and out["TCS.NS"].market_date is None
    assert out["INFY.BO"].price == D("1500.25") and out["INFY.BO"].company_name == "Infosys"
    assert len(calls) == 1 and calls[0] == ("/stock/list", {"symbols": "TCS.NS,INFY.BO", "res": "num"})


def test_only_symbols_are_sent_to_the_provider(monkeypatch):
    calls = serve(monkeypatch, lambda p, q: (200, {"status": "success", "results": []}) if p == "/search" else listing(stock("TCS.NS", 100)))
    sp.fetch_quotes(["TCS.NS"])
    sp.search("tata")
    assert {path for path, _ in calls} == {"/stock/list", "/search"}
    assert all(set(params) <= {"symbols", "res", "q"} for _, params in calls)


@pytest.mark.parametrize("bad", ["N/A", None, "", "abc", 0, -5, "-1.5", float("nan"), float("inf"), 1e12, True, [1], {"v": 1}])
def test_anything_that_is_not_a_real_positive_price_is_no_price_never_zero(monkeypatch, bad):
    serve(monkeypatch, lambda p, q: listing(stock("TCS.NS", bad)))
    assert sp.fetch_quotes(["TCS.NS"]) == {"TCS.NS": None}


def test_a_symbol_the_provider_could_not_price_is_none_and_the_others_still_work(monkeypatch):
    serve(monkeypatch, lambda p, q: listing(stock("TCS.NS", 100), {"symbol": "NOPE", "exchange": "NSE", "ticker": "NOPE.NS", "error": "No data available"}))
    out = sp.fetch_quotes(["TCS.NS", "NOPE.NS", "MISSING.NS"])
    assert out["TCS.NS"].price == D("100.00") and out["NOPE.NS"] is None and out["MISSING.NS"] is None


def test_a_quote_for_a_symbol_that_was_not_asked_about_is_ignored(monkeypatch):
    serve(monkeypatch, lambda p, q: listing(stock("EVIL.NS", 1), stock("TCS.NS", 100)))
    out = sp.fetch_quotes(["TCS.NS"])
    assert list(out) == ["TCS.NS"] and out["TCS.NS"].price == D("100.00")


@pytest.mark.parametrize(
    "answer",
    [
        (200, None),
        (200, []),
        (200, {"status": "error", "message": "x"}),
        (200, {"status": "success"}),
        (200, {"status": "success", "stocks": "nope"}),
        (400, {"status": "error", "message": "bad"}),
        (404, {"status": "error"}),
    ],
)
def test_a_malformed_or_error_answer_is_a_provider_error_not_a_price(monkeypatch, answer):
    serve(monkeypatch, lambda p, q: answer)
    with pytest.raises(sp.ProviderError) as error:
        sp.fetch_quotes(["TCS.NS"])
    assert error.value.code == "bad_response"


def test_garbage_entries_in_the_list_are_skipped(monkeypatch):
    serve(monkeypatch, lambda p, q: (200, {"status": "success", "stocks": [None, 5, "x", {"ticker": 7}, stock("TCS.NS", 100)]}))
    assert sp.fetch_quotes(["TCS.NS"])["TCS.NS"].price == D("100.00")


def test_a_server_error_or_throttle_is_unavailable_and_backs_off(monkeypatch):
    calls = serve(monkeypatch, lambda p, q: (503, None))
    with pytest.raises(sp.ProviderError) as first:
        sp.fetch_quotes(["TCS.NS"])
    assert first.value.code == "unavailable" and len(calls) == 1
    with pytest.raises(sp.ProviderError) as second:  # inside the backoff: no new request at all
        sp.fetch_quotes(["INFY.NS"])
    assert second.value.code == "unavailable" and len(calls) == 1
    sp.reset_for_tests()
    serve(monkeypatch, lambda p, q: (429, None))
    with pytest.raises(sp.ProviderError):
        sp.fetch_quotes(["TCS.NS"])


def test_a_network_failure_is_a_provider_error(monkeypatch):
    def boom(path, params):
        raise sp.ProviderError("timeout", "The price service did not answer in time.")

    monkeypatch.setattr(sp, "_http_get", boom)
    with pytest.raises(sp.ProviderError) as error:
        sp.fetch_quotes(["TCS.NS"])
    assert error.value.code == "timeout"


def test_recent_prices_are_cached_and_a_new_symbol_asks_only_for_itself(monkeypatch):
    calls = serve(monkeypatch, lambda p, q: listing(*[stock(t, 100) for t in q["symbols"].split(",")]))
    sp.fetch_quotes(["TCS.NS"])
    sp.fetch_quotes(["TCS.NS"])
    assert len(calls) == 1
    sp.fetch_quotes(["TCS.NS", "INFY.NS"])
    assert calls[-1][1]["symbols"] == "INFY.NS" and len(calls) == 2


def test_a_failed_symbol_is_not_cached_as_a_price(monkeypatch):
    calls = serve(monkeypatch, lambda p, q: listing({"ticker": "TCS.NS", "error": "No data available"}))
    assert sp.fetch_quotes(["TCS.NS"])["TCS.NS"] is None
    serve(monkeypatch, lambda p, q: listing(stock("TCS.NS", 120)))
    assert sp.fetch_quotes(["TCS.NS"])["TCS.NS"].price == D("120.00")
    assert len(calls) == 1


def test_large_lists_are_split_into_batches_and_invalid_tickers_are_refused(monkeypatch):
    tickers = [f"S{i}.NS" for i in range(sp.MAX_BATCH + 5)]
    calls = serve(monkeypatch, lambda p, q: listing(*[stock(t, 10) for t in q["symbols"].split(",")]))
    out = sp.fetch_quotes(tickers)
    assert len(calls) == 2 and all(out[t].price == D("10.00") for t in tickers)
    with pytest.raises(ValueError):
        sp.fetch_quotes(["bad ticker"])


# ---- search -------------------------------------------------------------------------------------------------------


def test_search_returns_clean_unique_symbols(monkeypatch):
    results = [
        {"symbol": "RELIANCE", "company_name": "Reliance Industries"},
        {"symbol": "reliance", "company_name": "dup"},
        {"symbol": "bad symbol!", "company_name": "x"},
        {"symbol": "TCS"},
        "junk",
    ]
    serve(monkeypatch, lambda p, q: (200, {"status": "success", "results": results}))
    hits = sp.search("rel")
    assert [(h.symbol, h.company_name) for h in hits] == [("RELIANCE", "Reliance Industries"), ("TCS", "TCS")]


def test_search_with_no_match_is_empty_and_a_failure_is_an_error(monkeypatch):
    serve(monkeypatch, lambda p, q: (404, {"status": "error", "message": "No results"}))
    assert sp.search("zzzz") == []
    sp.reset_for_tests()
    serve(monkeypatch, lambda p, q: (200, {"status": "success", "results": "nope"}))
    with pytest.raises(sp.ProviderError) as error:
        sp.search("tata")
    assert error.value.code == "bad_response"


def test_search_results_are_cached(monkeypatch):
    calls = serve(monkeypatch, lambda p, q: (200, {"status": "success", "results": [{"symbol": "TCS", "company_name": "TCS"}]}))
    sp.search("tcs")
    sp.search("TCS ")
    assert len(calls) == 1


# ---- the real HTTP layer, against a local server ----------------------------------------------------------------------


class _Handler(BaseHTTPRequestHandler):
    behaviour = "ok"

    def do_GET(self):  # noqa: N802
        kind = type(self).behaviour
        if kind == "slow":
            time.sleep(1.5)
        if kind == "html":
            body, ctype = b"<html>not json</html>", "text/html"
        elif kind == "huge":
            body, ctype = b"x" * (sp.MAX_RESPONSE_BYTES + 10), "application/json"
        elif kind == "500":
            self.send_response(500)
            self.end_headers()
            return
        else:
            body, ctype = json.dumps({"status": "success", "stocks": [stock("TCS.NS", 99.5)], "path": self.path}).encode(), "application/json"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@pytest.fixture()
def local_provider(monkeypatch):
    server = HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setattr(settings, "MARKET_API_BASE_URL", f"http://127.0.0.1:{server.server_port}")
    monkeypatch.setattr(settings, "MARKET_API_TIMEOUT_SECONDS", 0.4)
    _Handler.behaviour = "ok"
    yield _Handler
    server.shutdown()


def test_a_real_request_reads_the_answer_and_sends_the_documented_query(local_provider):
    out = sp.fetch_quotes(["TCS.NS"])
    assert out["TCS.NS"].price == D("99.50")


def test_a_slow_provider_times_out_quickly(local_provider):
    local_provider.behaviour = "slow"
    started = time.monotonic()
    with pytest.raises(sp.ProviderError) as error:
        sp.fetch_quotes(["TCS.NS"])
    assert error.value.code == "timeout" and time.monotonic() - started < 1.2


@pytest.mark.parametrize("behaviour,code", [("html", "bad_response"), ("huge", "bad_response"), ("500", "unavailable")])
def test_a_real_bad_answer_is_a_provider_error(local_provider, behaviour, code):
    local_provider.behaviour = behaviour
    with pytest.raises(sp.ProviderError) as error:
        sp.fetch_quotes(["TCS.NS"])
    assert error.value.code == code


def test_an_unreachable_provider_is_unavailable(monkeypatch):
    monkeypatch.setattr(settings, "MARKET_API_BASE_URL", "http://127.0.0.1:9")  # nothing listens there
    monkeypatch.setattr(settings, "MARKET_API_TIMEOUT_SECONDS", 0.5)
    with pytest.raises(sp.ProviderError) as error:
        sp.fetch_quotes(["TCS.NS"])
    assert error.value.code in ("unavailable", "timeout")


def test_the_base_url_setting_must_be_http_or_https():
    from app.config import Settings

    assert Settings(_env_file=None, MARKET_API_BASE_URL=" https://example.com/ ").MARKET_API_BASE_URL == "https://example.com"
    with pytest.raises(ValueError):
        Settings(_env_file=None, MARKET_API_BASE_URL="ftp://example.com")


# ---- the Yahoo Finance mode ----------------------------------------------------------------------------------------------------


def chart(ticker, price, moment=1792749506, name="Acme Limited"):
    return (200, {"chart": {"result": [{"meta": {"symbol": ticker, "regularMarketPrice": price, "regularMarketTime": moment, "longName": name}}], "error": None}})


@pytest.fixture()
def yahoo(monkeypatch):
    monkeypatch.setattr(settings, "MARKET_PROVIDER", "yahoo")


def test_yahoo_prices_are_read_strictly_one_symbol_at_a_time(monkeypatch, yahoo):
    answers = {"A.NS": chart("A.NS", 1190.0), "B.NS": chart("B.NS", 0), "C.NS": chart("OTHER.NS", 50.0), "D.NS": (404, None)}
    calls = serve(monkeypatch, lambda path, params: answers[path.rsplit("/", 1)[1]])
    got = sp.fetch_quotes(["A.NS", "B.NS", "C.NS", "D.NS"])
    assert got["A.NS"].price == D("1190.00") and got["A.NS"].market_date == "2026-10-23" and got["A.NS"].company_name == "Acme Limited"
    assert got["B.NS"] is None  # a zero price is no price
    assert got["C.NS"] is None  # an answer about a symbol we did not ask for is refused
    assert got["D.NS"] is None  # unknown symbol
    assert sorted(path for path, _ in calls) == sorted(f"/v8/finance/chart/{t}" for t in answers)


def test_yahoo_search_keeps_only_indian_equities_and_deduplicates(monkeypatch, yahoo):
    body = {"quotes": [
        {"symbol": "RELIANCE.NS", "quoteType": "EQUITY", "longname": "Reliance Industries Limited"},
        {"symbol": "RELIANCE.BO", "quoteType": "EQUITY", "shortname": "RELIANCE"},
        {"symbol": "RELI", "quoteType": "EQUITY", "longname": "A US company"},
        {"symbol": "RELIANCE-FUT.NS", "quoteType": "FUTURE"},
        {"symbol": "TCS.NS", "quoteType": "EQUITY", "shortname": "TATA CONSULTANCY"},
    ]}
    serve(monkeypatch, lambda path, params: (200, body))
    assert [(h.symbol, h.company_name) for h in sp.search("rel")] == [("RELIANCE", "Reliance Industries Limited"), ("TCS", "TATA CONSULTANCY")]


def test_a_yahoo_rate_limit_is_a_service_failure_and_backs_off(monkeypatch, yahoo):
    calls = serve(monkeypatch, lambda path, params: (429, None))
    with pytest.raises(sp.ProviderError) as first:
        sp.fetch_quotes(["A.NS"])
    assert first.value.code == "unavailable"
    with pytest.raises(sp.ProviderError):
        sp.fetch_quotes(["B.NS"])
    assert len(calls) == 1  # the second call failed fast without asking again


def test_the_source_name_follows_the_provider(monkeypatch, yahoo):
    assert "Yahoo" in sp.source_name() and "Indian-Stock-Market-API" not in sp.source_name()
    monkeypatch.setattr(settings, "MARKET_PROVIDER", "indian_api")
    assert "Indian-Stock-Market-API" in sp.source_name()
