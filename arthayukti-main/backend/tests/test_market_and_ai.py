from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi.testclient import TestClient

from app.db.models import MarketDataSnapshot
from app.db.session import SessionLocal
from app.main import app

client = TestClient(app)


def _store_quote(symbol: str, age: timedelta) -> None:
    db = SessionLocal()
    try:
        db.add(
            MarketDataSnapshot(
                symbol=symbol,
                asset_type="equity_index",
                price=Decimal("123.4500"),
                currency="INR",
                source="TEST_FEED",
                fetched_at=datetime.now(UTC) - age,
                is_stale=False,
            )
        )
        db.commit()
    finally:
        db.close()


def test_a_symbol_with_no_stored_quote_is_unavailable_not_invented():
    for symbol in ("NIFTY_50", "UNKNOWN_TICKER"):
        res = client.get(f"/api/v1/market/quotes/{symbol}")
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "unavailable"
        assert body["price"] is None
        assert body["source"] is None
        assert "verified" not in (body["message"] or "").lower()


def test_stored_quotes_report_their_age():
    _store_quote("FRESHCO", timedelta(hours=1))
    _store_quote("OLDCO", timedelta(days=3))
    fresh = client.get("/api/v1/market/quotes/freshco").json()
    old = client.get("/api/v1/market/quotes/OLDCO").json()
    assert fresh["status"] == "fresh" and fresh["price"] == "123.4500"
    assert fresh["source"] == "TEST_FEED"
    assert old["status"] == "stale" and "24 hours" in old["message"]


def test_bad_symbols_are_rejected():
    assert client.get("/api/v1/market/quotes/bad%20symbol!").status_code == 422


def test_ai_intent_parsing_reads_amounts_that_are_marked_as_money():
    res = client.post(
        "/api/v1/ai/parse-intent",
        json={
            "prompt": "I want to buy a car for 8 lakh without debt and save for kid education for 15 lakh"
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["extraction_method"] == "keyword_rules"
    assert "avoid_new_debt" in body["detected_constraints"]
    amounts = {g["label"]: g["target_amount_today"] for g in body["identified_goals"]}
    assert Decimal(amounts["Car purchase"]) == Decimal("800000")
    assert Decimal(amounts["Education"]) == Decimal("1500000")
    assert "not calculations" in body["plain_english_summary"]


def test_a_time_span_is_never_read_as_a_price():
    res = client.post("/api/v1/ai/parse-intent", json={"prompt": "Can I buy a car in 2 years?"})
    body = res.json()
    assert body["identified_goals"] == []
    assert any("car" in item.lower() for item in body["missing_critical_info"])


def test_parse_intent_no_longer_takes_the_text_in_the_url():
    assert client.post("/api/v1/ai/parse-intent", params={"prompt": "buy a car"}).status_code == 422
