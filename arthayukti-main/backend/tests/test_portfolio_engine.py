"""Portfolio valuation arithmetic, worked out by hand beside each assertion."""

from decimal import Decimal

from app.engine.portfolio import PositionIn, invested_timeline, percent, value_portfolio

D = Decimal


def pos(id_, qty, cost, price, *, bought=None, realised="0", dividends="0"):
    return PositionIn(id_, D(qty), D(cost), D(bought if bought is not None else cost), D(realised), D(dividends), None if price is None else D(price))


def test_a_single_holding_follows_the_basic_formulas():
    out = value_portfolio([pos("a", "100", "5000", "60")])  # 100 shares bought at 50
    row, totals = out["rows"][0], out["totals"]
    assert row["invested"] == D("5000.00")  # 100 x 50
    assert row["market_value"] == D("6000.00")  # 100 x 60
    assert row["unrealised"] == D("1000.00")  # 6000 - 5000
    assert row["unrealised_pct"] == D("20.00")  # 1000 / 5000
    assert row["average_cost"] == D("50.0000")
    assert (totals["value"], totals["unrealised"], totals["unrealised_pct"]) == (D("6000.00"), D("1000.00"), D("20.00"))
    assert totals["complete"] is True


def test_a_loss_is_negative_and_a_zero_cost_basis_is_safe():
    loss = value_portfolio([pos("a", "10", "1000", "80")])["rows"][0]  # 800 now, 1000 paid
    assert (loss["unrealised"], loss["unrealised_pct"]) == (D("-200.00"), D("-20.00"))
    free = value_portfolio([pos("b", "10", "0", "50")])["rows"][0]  # units received free: nothing to divide by
    assert free["unrealised"] == D("500.00") and free["unrealised_pct"] is None
    assert percent(D("5"), D("0")) is None


def test_the_portfolio_return_is_weighted_by_money_not_an_average_of_percentages():
    out = value_portfolio([pos("small", "100", "10000", "120"), pos("large", "900", "90000", "90")])
    # small: 10000 -> 12000 (+20%). large: 90000 -> 81000 (-10%).
    assert [r["unrealised_pct"] for r in out["rows"]] == [D("20.00"), D("-10.00")]
    t = out["totals"]
    assert (t["invested_priced"], t["value"], t["unrealised"]) == (D("100000.00"), D("93000.00"), D("-7000.00"))
    assert t["unrealised_pct"] == D("-7.00")  # -7000 / 100000. The naive average of +20 and -10 would be +5.
    assert [r["weight_pct"] for r in out["rows"]] == [D("12.90"), D("87.10")]  # 12000/93000 and 81000/93000


def test_a_holding_without_a_price_is_left_out_of_value_and_reported_never_zero():
    out = value_portfolio([pos("a", "10", "1000", "150"), pos("b", "20", "4000", None)])
    unpriced = out["rows"][1]
    assert unpriced["market_value"] is None and unpriced["unrealised"] is None and unpriced["unrealised_pct"] is None
    t = out["totals"]
    assert (t["priced_positions"], t["unpriced_positions"], t["open_positions"]) == (1, 1, 2)
    assert (t["invested_priced"], t["invested_unpriced"], t["value"], t["unrealised"]) == (D("1000.00"), D("4000.00"), D("1500.00"), D("500.00"))
    assert t["complete"] is False  # the total is of one holding, and says so


def test_nothing_priced_gives_no_percentage():
    t = value_portfolio([pos("a", "10", "1000", None)])["totals"]
    assert t["value"] == D("0.00") and t["unrealised_pct"] is None and t["priced_positions"] == 0 and t["complete"] is False


def test_realised_and_unrealised_are_separate_and_counted_once():
    # Bought 100 at 50 (5000). Sold 40 at 70: realised (70-50) x 40 = 800. 60 left, cost 3000, price 65 -> 3900, unrealised 900.
    held = pos("a", "60", "3000", "65", bought="5000", realised="800")
    out = value_portfolio([held])
    row, t = out["rows"][0], out["totals"]
    assert (row["unrealised"], row["realised"]) == (D("900.00"), D("800.00"))
    assert t["total_profit"] == D("1700.00")  # 900 + 800, each once
    assert t["total_return_pct"] == D("34.00")  # 1700 / 5000 bought


def test_a_fully_sold_position_has_realised_profit_and_no_unrealised():
    sold = pos("a", "0", "0", None, bought="5000", realised="1000", dividends="50")
    out = value_portfolio([sold])
    row, t = out["rows"][0], out["totals"]
    assert row["closed"] and row["market_value"] == D("0.00") and row["average_cost"] is None
    assert (t["open_positions"], t["unrealised"], t["realised"], t["dividends"]) == (0, D("0.00"), D("1000.00"), D("50.00"))
    assert t["total_profit"] == D("1050.00") and t["total_return_pct"] == D("21.00")  # 1050 / 5000
    assert t["complete"] is False  # nothing open to value


def test_rounding_is_half_up_to_the_paisa_and_the_rows_add_up_to_the_total():
    out = value_portfolio([pos("a", "3", "100", "33.335"), pos("b", "7", "100", "1.005")])
    assert out["rows"][0]["market_value"] == D("100.01")  # 100.005 rounds up
    assert out["rows"][1]["market_value"] == D("7.04")  # 7.035 rounds up
    assert out["totals"]["value"] == sum(r["market_value"] for r in out["rows"])


def test_the_invested_timeline_needs_no_prices_and_follows_dated_transactions():
    a = [("2026-01-10", D("1000")), ("2026-03-01", D("2500"))]  # a second purchase
    b = [("2026-02-01", D("4000")), ("2026-04-01", D("0"))]  # bought, then fully sold
    assert invested_timeline([a, b]) == [
        ("2026-01-10", D("1000.00")),
        ("2026-02-01", D("5000.00")),
        ("2026-03-01", D("6500.00")),
        ("2026-04-01", D("2500.00")),
    ]
    assert invested_timeline([]) == []
