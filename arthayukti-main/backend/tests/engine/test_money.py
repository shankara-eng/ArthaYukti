from decimal import Decimal

from app.engine.money import ceil_paise, quantize


def test_quantize_rounds_half_up():
    assert quantize(Decimal("0.005")) == Decimal("0.01")
    assert quantize(Decimal("0.004")) == Decimal("0.00")
    assert quantize(Decimal("112682.503")) == Decimal("112682.50")
    assert quantize(Decimal("2.675")) == Decimal("2.68")


def test_ceil_paise_never_understates():
    assert ceil_paise(Decimal("40000")) == Decimal("40000.00")
    assert ceil_paise(Decimal("68571.4285714")) == Decimal("68571.43")
    assert ceil_paise(Decimal("0.001")) == Decimal("0.01")


def test_quantize_keeps_two_places():
    assert str(quantize(Decimal("5"))) == "5.00"
