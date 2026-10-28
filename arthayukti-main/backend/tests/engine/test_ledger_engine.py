"""Holdings ledger arithmetic. Each expected figure is worked out by hand in the comment beside it."""

from decimal import Decimal

import pytest

from app.engine.ledger import LedgerError, Txn, reconcile

D = Decimal


def t(id_, type_, date, quantity=None, price=None, fees="0.00", new=None, old=None):
    return Txn(
        id_,
        type_,
        date,
        None if quantity is None else D(quantity),
        None if price is None else D(price),
        D(fees),
        new,
        old,
    )


def history():
    return [
        t("b1", "buy", "2027-01-10", "100", "50", "100.00"),  # cost 100 x 50 + 100 = 5,100.00
        t("b2", "buy", "2027-03-01", "50", "60", "50.00"),  # cost 50 x 60 + 50 = 3,050.00
        t("sp", "split", "2027-04-01", new=2, old=1),  # 200 + 100 units, cost unchanged
        t("dv", "dividend", "2027-05-01", price="2", fees="60.00"),  # 300 x 2 = 600 gross, 540 net
        t("bn", "bonus", "2027-06-01", new=1, old=10),  # 300 / 10 = 30 free units
        t("s1", "sell", "2027-07-01", "250", "40", "80.00"),  # proceeds 250 x 40 - 80 = 9,920.00
    ]


def test_buys_splits_dividends_bonuses_and_a_fifo_sale_reconcile_by_hand():
    p = reconcile(history())
    # FIFO: the first lot (200 units after the split, cost 5,100) goes first, then 50 of the 100-unit lot,
    # which gives up 3,050 x 50 / 100 = 1,525. Cost sold = 6,625. Realised = 9,920 - 6,625 = 3,295.
    assert p.realised_gain == D("3295.00")
    # Left: 50 units of the second lot (cost 1,525) and the 30 bonus units (cost 0) = 80 units, cost 1,525.
    assert p.quantity == D("80") and p.cost_basis == D("1525.00")
    assert p.average_cost == D("19.0625")  # 1,525 / 80
    assert p.dividends_gross == D("600.00") and p.dividends_net == D("540.00")
    assert p.fees_paid == D("230.00")  # 100 + 50 on the buys, 80 on the sale (the dividend's 60 is separate)
    # Everything bought (5,100 + 3,050) is either sold (6,625) or still held (1,525).
    assert D("5100.00") + D("3050.00") == D("6625.00") + p.cost_basis


def test_the_sale_reports_how_long_each_lot_was_held_in_days():
    p = reconcile(history())
    first, second = p.sales
    # 10 January to 1 July 2027 = 21 (Jan) + 28 + 31 + 30 + 31 + 30 + 1 = 172 days; 1 March to 1 July = 122 days.
    assert (first.days_held, first.quantity, first.cost) == (172, D("200"), D("5100.00"))
    assert (second.days_held, second.quantity, second.cost) == (122, D("50"), D("1525.00"))


def test_the_running_position_after_each_transaction_is_recorded():
    events = {e.txn_id: e for e in reconcile(history()).events}
    assert (events["b1"].quantity_after, events["b1"].cash) == (D("100"), D("-5100.00"))
    assert (events["sp"].quantity_after, events["sp"].cost_basis_after) == (D("300"), D("8150.00"))
    assert events["dv"].cash == D("540.00") and events["dv"].quantity_after == D("300")
    assert events["bn"].quantity_after == D("330") and events["bn"].cost_basis_after == D("8150.00")
    assert events["s1"].realised_gain == D("3295.00") and events["s1"].cash == D("9920.00")


def test_a_sale_of_units_not_held_is_refused_with_the_reason():
    with pytest.raises(LedgerError, match="hold 10 units"):
        reconcile([t("b", "buy", "2027-01-01", "10", "5"), t("s", "sell", "2027-01-02", "11", "5")])


def test_the_order_within_a_day_is_the_order_recorded():
    buy, sell = t("b", "buy", "2027-01-01", "10", "5"), t("s", "sell", "2027-01-01", "10", "5")
    assert reconcile([buy, sell]).quantity == 0
    with pytest.raises(LedgerError):
        reconcile([sell, buy])


def test_a_fully_sold_position_is_empty_with_no_average_cost():
    p = reconcile([t("b", "buy", "2027-01-01", "10", "5"), t("s", "sell", "2027-02-01", "10", "7")])
    assert p.quantity == 0 and p.cost_basis == 0 and p.average_cost is None
    assert p.realised_gain == D("20.00")  # 70 - 50


def test_a_reverse_split_halves_the_units_and_keeps_the_cost():
    p = reconcile([t("b", "buy", "2027-01-01", "3", "10"), t("r", "split", "2027-02-01", new=1, old=2)])
    assert p.quantity == D("1.5") and p.cost_basis == D("30.00")


def test_a_split_that_does_not_divide_evenly_rounds_to_six_places():
    p = reconcile([t("b", "buy", "2027-01-01", "10", "3"), t("r", "split", "2027-02-01", new=1, old=3)])
    assert p.quantity == D("3.333333") and p.cost_basis == D("30.00")


def test_a_partly_sold_lot_gives_up_a_rounded_share_of_cost_and_the_rest_stays():
    # 3 units at 3.335 = 10.005, rounded half up to 10.01. Selling 1 gives up 10.01 / 3 = 3.3367 -> 3.34; 6.67 stays.
    p = reconcile([t("b", "buy", "2027-01-01", "3", "3.335"), t("s", "sell", "2027-02-01", "1", "5")])
    assert p.sales[0].cost == D("3.34") and p.cost_basis == D("6.67")
    assert D("3.34") + p.cost_basis == D("10.01")


def test_dividends_and_corporate_actions_need_units_to_be_held():
    for txn in (t("d", "dividend", "2027-01-01", price="1"), t("s", "split", "2027-01-01", new=2, old=1), t("n", "bonus", "2027-01-01", new=1, old=1)):
        with pytest.raises(LedgerError):
            reconcile([txn])


def test_charges_larger_than_the_dividend_are_refused():
    with pytest.raises(LedgerError, match="larger than the dividend"):
        reconcile([t("b", "buy", "2027-01-01", "10", "5"), t("d", "dividend", "2027-02-01", price="1", fees="11.00")])


def test_dividends_never_change_units_or_cost_basis():
    base = reconcile([t("b", "buy", "2027-01-01", "10", "5")])
    with_dividend = reconcile([t("b", "buy", "2027-01-01", "10", "5"), t("d", "dividend", "2027-02-01", price="3")])
    assert (with_dividend.quantity, with_dividend.cost_basis) == (base.quantity, base.cost_basis)
    assert with_dividend.dividends_gross == D("30.00")


def test_fractional_mutual_fund_units_are_exact():
    # 81.0001 units at a NAV of 12.3456: 81 x 12.3456 = 999.9936, plus 0.0001 x 12.3456 = 0.0012, so 999.9948 -> 999.99.
    p = reconcile([t("b", "buy", "2027-01-01", "81.000100", "12.3456")])
    assert p.quantity == D("81.0001") and p.cost_basis == D("999.99")
