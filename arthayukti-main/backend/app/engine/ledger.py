"""Holdings ledger: turns a list of dated transactions into a position, cost basis and realised gain.

Conventions (see also docs/HOLDINGS_LEDGER.md):
- These are actual, past transactions the person recorded. They are never assumptions or forecasts.
- Transactions are replayed in date order; on the same date, in the order they were recorded.
- Lots are consumed first-in, first-out. A buy's cost is quantity x price + fees, rounded half-up to the paisa.
  A partly sold lot gives up a proportional share of its cost (rounded half-up to the paisa); the rest stays in the lot,
  so the cost of everything bought always equals the cost sold plus the cost still held.
- A split (new : old) multiplies every lot's quantity by new / old and leaves its total cost alone, so the cost per unit
  falls. A bonus (new : old) adds a new lot of held x new / old units at no cost, dated on the bonus date. Quantities are
  rounded half-up to 6 places; a reverse split that does not divide evenly therefore carries a rounding of up to half a
  millionth of a unit per lot, and no cash-in-lieu is modelled.
- A dividend is cash: units held on the date x amount per unit, less any charges or tax withheld. It never changes the
  quantity or the cost basis.
- A sale larger than the units held on its date is refused. Nothing is ever sold short.
- No taxes are computed here. The holding period of each lot sold is reported in days so that a tax rule can use it.
"""

from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

PAISA = Decimal("0.01")
UNIT = Decimal("0.000001")
ZERO = Decimal(0)

BUY, SELL, SPLIT, BONUS, DIVIDEND = "buy", "sell", "split", "bonus", "dividend"
TYPES = (BUY, SELL, SPLIT, BONUS, DIVIDEND)


class LedgerError(ValueError):
    """The transactions cannot be replayed (for example a sale of units that were not held)."""


def paisa(value: Decimal) -> Decimal:
    return value.quantize(PAISA, rounding=ROUND_HALF_UP)


def units(value: Decimal) -> Decimal:
    return value.quantize(UNIT, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class Txn:
    id: str
    type: str
    date: str  # YYYY-MM-DD
    quantity: Decimal | None = None
    price: Decimal | None = None
    fees: Decimal = ZERO
    ratio_new: int | None = None
    ratio_old: int | None = None


@dataclass
class Lot:
    acquired: str
    quantity: Decimal
    cost: Decimal
    origin: str  # "buy" or "bonus"


@dataclass(frozen=True)
class SaleLot:
    acquired: str
    quantity: Decimal
    cost: Decimal
    days_held: int


@dataclass(frozen=True)
class Event:
    """The position straight after one transaction, for the running ledger."""

    txn_id: str
    date: str
    type: str
    quantity_after: Decimal
    cost_basis_after: Decimal
    realised_gain: Decimal  # this transaction's realised gain (sales only), else 0.00
    cash: Decimal  # cash paid (negative) or received (positive) by this transaction


@dataclass
class Position:
    quantity: Decimal = ZERO
    cost_basis: Decimal = ZERO
    realised_gain: Decimal = ZERO
    dividends_gross: Decimal = ZERO
    dividends_net: Decimal = ZERO
    fees_paid: Decimal = ZERO  # fees on buys and sales
    lots: list[Lot] = field(default_factory=list)
    sales: list[SaleLot] = field(default_factory=list)
    events: list[Event] = field(default_factory=list)

    @property
    def average_cost(self) -> Decimal | None:
        if self.quantity <= 0:
            return None
        return (self.cost_basis / self.quantity).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def _days(start: str, end: str) -> int:
    return (date.fromisoformat(end) - date.fromisoformat(start)).days


def _held(lots: list[Lot]) -> Decimal:
    return sum((lot.quantity for lot in lots), ZERO)


def _sell(position: Position, txn: Txn) -> tuple[Decimal, Decimal]:
    assert txn.quantity is not None and txn.price is not None
    held = _held(position.lots)
    if txn.quantity > held:
        raise LedgerError(f"On {txn.date} you hold {held.normalize():f} units, so {txn.quantity.normalize():f} cannot be sold.")
    remaining = txn.quantity
    consumed = ZERO
    while remaining > 0:
        lot = position.lots[0]
        if lot.quantity <= remaining:
            take, cost = lot.quantity, lot.cost
            position.lots.pop(0)
        else:
            take = remaining
            cost = paisa(lot.cost * take / lot.quantity)
            lot.quantity -= take
            lot.cost -= cost
        consumed += cost
        remaining -= take
        position.sales.append(SaleLot(lot.acquired, take, cost, _days(lot.acquired, txn.date)))
    proceeds = paisa(txn.quantity * txn.price - txn.fees)
    return proceeds, proceeds - consumed


def reconcile(transactions: list[Txn]) -> Position:
    """Replay `transactions` (already in date order, ties in recorded order) into a position."""
    position = Position()
    previous = ""
    for txn in transactions:
        if txn.type not in TYPES:
            raise LedgerError(f"Unknown transaction type {txn.type}.")
        if txn.date < previous:
            raise LedgerError("Transactions must be replayed in date order.")
        previous = txn.date
        cash = ZERO
        gain = ZERO
        if txn.type == BUY:
            assert txn.quantity is not None and txn.price is not None
            cost = paisa(txn.quantity * txn.price + txn.fees)
            position.lots.append(Lot(txn.date, txn.quantity, cost, BUY))
            position.fees_paid += txn.fees
            cash = -cost
        elif txn.type == SELL:
            cash, gain = _sell(position, txn)
            position.realised_gain += gain
            position.fees_paid += txn.fees
        elif txn.type in (SPLIT, BONUS):
            assert txn.ratio_new and txn.ratio_old
            held = _held(position.lots)
            if held <= 0:
                raise LedgerError(f"A {txn.type} on {txn.date} needs units to be held on that date.")
            if txn.type == SPLIT:
                for lot in position.lots:
                    lot.quantity = units(lot.quantity * txn.ratio_new / txn.ratio_old)
            else:
                position.lots.append(Lot(txn.date, units(held * txn.ratio_new / txn.ratio_old), ZERO, BONUS))
        elif txn.type == DIVIDEND:
            assert txn.price is not None
            held = _held(position.lots)
            if held <= 0:
                raise LedgerError(f"A dividend on {txn.date} needs units to be held on that date.")
            gross = paisa(held * txn.price)
            net = gross - txn.fees
            if net < 0:
                raise LedgerError(f"The charges on the {txn.date} dividend are larger than the dividend.")
            position.dividends_gross += gross
            position.dividends_net += net
            cash = net
        position.events.append(
            Event(txn.id, txn.date, txn.type, _held(position.lots), sum((lot.cost for lot in position.lots), ZERO), gain, cash)
        )
    position.quantity = _held(position.lots)
    position.cost_basis = sum((lot.cost for lot in position.lots), ZERO)
    return position
