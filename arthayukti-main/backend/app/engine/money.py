"""Rounding rules. Everything is quantised to the paisa; only required amounts round up."""

from collections.abc import Iterator
from contextlib import contextmanager
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal, localcontext

PAISE = Decimal("0.01")
ZERO = Decimal("0.00")
ENGINE_PRECISION = 40


def quantize(amount: Decimal) -> Decimal:
    """Round half-up to the paisa."""
    return amount.quantize(PAISE, rounding=ROUND_HALF_UP)


def ceil_paise(amount: Decimal) -> Decimal:
    """Round up to the paisa, so a required amount is never understated."""
    return amount.quantize(PAISE, rounding=ROUND_CEILING)


@contextmanager
def engine_context() -> Iterator[None]:
    """Run with enough precision that long compounding chains stay exact to the paisa."""
    with localcontext() as context:
        context.prec = ENGINE_PRECISION
        yield
