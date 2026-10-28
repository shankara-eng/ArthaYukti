"""Stock portfolio valuation: what was put in, what it is worth at the latest price, and the profit or loss.

Pure Decimal arithmetic over positions that the holdings ledger has already worked out (FIFO cost basis, realised gain,
dividends). Definitions, applied the same way everywhere:

- Invested (cost basis) = the cost of the units still held, including the buy charges recorded with them. For a plain
  holding of `quantity` bought at `average price` with no charges this is quantity x average price.
- Current value = quantity held x the latest available price. Without a usable price there is no value: it is left
  out and reported, never treated as zero.
- Unrealised profit or loss = current value - invested. Unrealised return % = that / invested x 100 (none if invested is 0).
- Realised profit or loss = gains already booked on units sold (FIFO, after sale charges), from the ledger. It is
  never added into the unrealised figure, so a gain is counted once.
- Totals are sums over the positions. A portfolio return % is total profit / total invested, which weights each
  holding by its money; individual percentages are never averaged.
- Totals of value and unrealised cover only the positions that have a price. How many do is reported with them, and the
  invested amount of the positions without a price is reported separately.
- Not included in any figure: taxes, brokerage charges that were not entered as transaction fees, corporate actions that were
  not recorded (splits and bonus units are in the ledger only when entered), and the effect of inflation.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

ZERO = Decimal("0.00")
HUNDRED = Decimal(100)


def money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def percent(part: Decimal, whole: Decimal) -> Decimal | None:
    """part / whole x 100 to two places, or None when there is no base to measure against."""
    if whole <= 0:
        return None
    return (part / whole * HUNDRED).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class PositionIn:
    id: str
    quantity: Decimal  # units still held
    cost_basis: Decimal  # cost of those units
    bought_total: Decimal  # everything ever paid to buy (for the overall return of closed and open positions)
    realised: Decimal
    dividends: Decimal
    price: Decimal | None  # latest usable price, or None


def value_position(p: PositionIn) -> dict:
    closed = p.quantity <= 0
    invested = money(p.cost_basis)
    market_value: Decimal | None
    if closed:
        market_value = ZERO
    elif p.price is not None:
        market_value = money(p.quantity * p.price)
    else:
        market_value = None
    unrealised = None if market_value is None else money(market_value - invested)
    return {
        "id": p.id,
        "closed": closed,
        "invested": invested,
        "average_cost": None if closed else (p.cost_basis / p.quantity).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP),
        "market_value": market_value,
        "unrealised": unrealised,
        "unrealised_pct": None if unrealised is None else percent(unrealised, invested),
        "realised": money(p.realised),
        "dividends": money(p.dividends),
    }


def value_portfolio(positions: list[PositionIn]) -> dict:
    """Per-position figures and totals, in the order given."""
    rows = [value_position(p) for p in positions]
    by_id = {p.id: p for p in positions}
    open_rows = [r for r in rows if not r["closed"]]
    priced = [r for r in open_rows if r["market_value"] is not None]
    unpriced = [r for r in open_rows if r["market_value"] is None]

    invested_priced = sum((r["invested"] for r in priced), ZERO)
    value_priced = sum((r["market_value"] for r in priced), ZERO)
    unrealised = value_priced - invested_priced
    realised = sum((r["realised"] for r in rows), ZERO)
    dividends = sum((r["dividends"] for r in rows), ZERO)

    # Overall return over every position that is fully accounted for: priced open ones and closed ones.
    accounted = priced + [r for r in rows if r["closed"]]
    bought = sum((money(by_id[r["id"]].bought_total) for r in accounted), ZERO)
    total_profit = (
        sum((r["unrealised"] for r in priced), ZERO)
        + sum((r["realised"] for r in accounted), ZERO)
        + sum((r["dividends"] for r in accounted), ZERO)
    )

    for r in rows:
        r["weight_pct"] = percent(r["market_value"], value_priced) if r["market_value"] is not None and not r["closed"] else None

    return {
        "rows": rows,
        "totals": {
            "open_positions": len(open_rows),
            "priced_positions": len(priced),
            "unpriced_positions": len(unpriced),
            "invested_priced": money(invested_priced),
            "invested_unpriced": money(sum((r["invested"] for r in unpriced), ZERO)),
            "value": money(value_priced),
            "unrealised": money(unrealised),
            "unrealised_pct": percent(unrealised, invested_priced),
            "realised": money(realised),
            "dividends": money(dividends),
            "total_profit": money(total_profit),
            "total_return_pct": percent(total_profit, bought),
            "complete": len(unpriced) == 0 and len(open_rows) > 0,
        },
    }


def invested_timeline(histories: list[list[tuple[str, Decimal]]]) -> list[tuple[str, Decimal]]:
    """Money tied up (cost basis of units held) by date, from each holding's dated ledger events.

    Each history is [(date, cost basis straight after that transaction), ...] in date order. At each date the figure
    is the sum, over holdings, of the cost basis after the latest transaction on or before it. This needs no price, so
    it is real history (what was invested when), unlike a value history."""
    dates = sorted({date for history in histories for date, _ in history})
    points: list[tuple[str, Decimal]] = []
    for date in dates:
        total = ZERO
        for history in histories:
            current = ZERO
            for when, cost in history:
                if when <= date:
                    current = cost
                else:
                    break
            total += current
        points.append((date, money(total)))
    return points
