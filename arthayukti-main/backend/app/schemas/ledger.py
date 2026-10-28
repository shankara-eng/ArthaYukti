from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import Field, model_validator

from app.engine.ledger import BUY, DIVIDEND, SELL, SPLIT
from app.schemas.types import Amount, ApiModel, DecimalStr

TransactionType = Literal["buy", "sell", "split", "bonus", "dividend"]

# Units may carry up to 6 decimals (mutual funds), prices up to 4 (NAV, share price), charges are rupees and paise.
Units = Annotated[DecimalStr, Field(gt=0, le=Decimal("1000000000"), max_digits=18, decimal_places=6)]
UnitPrice = Annotated[DecimalStr, Field(gt=0, le=Decimal("1000000000"), max_digits=18, decimal_places=4)]
Charges = Annotated[DecimalStr, Field(ge=0, le=Decimal("1000000000"), max_digits=14, decimal_places=2)]


class TransactionCreate(ApiModel):
    """One actual, past transaction on a holding.

    buy and sell: `quantity` and `price` (per unit). split and bonus: `ratio_new` and `ratio_old` (a 2-for-1 split is
    2 and 1; a 1-for-1 bonus is 1 and 1). dividend: `price` is the amount per unit held on that date. `fees` are
    brokerage and charges (for a dividend, tax or charges withheld).
    """

    transaction_type: TransactionType
    trade_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    quantity: Units | None = None
    price: UnitPrice | None = None
    fees: Charges = Decimal("0.00")
    ratio_new: int | None = Field(default=None, ge=1, le=1000)
    ratio_old: int | None = Field(default=None, ge=1, le=1000)
    notes: str | None = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def _check(self) -> "TransactionCreate":
        try:
            day = date.fromisoformat(self.trade_date)
        except ValueError:
            raise ValueError("trade_date must be a real date") from None
        if day > datetime.now(UTC).date():
            raise ValueError("A recorded transaction cannot be dated in the future. Plans and forecasts belong in the calculators.")
        kind = self.transaction_type
        if kind in (BUY, SELL):
            if self.quantity is None or self.price is None:
                raise ValueError("A buy or sale needs a quantity and a price per unit.")
            if self.ratio_new is not None or self.ratio_old is not None:
                raise ValueError("A buy or sale has no ratio.")
        elif kind == DIVIDEND:
            if self.price is None:
                raise ValueError("A dividend needs the amount per unit.")
            if self.quantity is not None or self.ratio_new is not None or self.ratio_old is not None:
                raise ValueError("A dividend is paid on the units held that day: do not send a quantity or ratio.")
        else:
            if self.ratio_new is None or self.ratio_old is None:
                raise ValueError("A split or bonus needs both parts of its ratio.")
            if self.quantity is not None or self.price is not None or self.fees != 0:
                raise ValueError("A split or bonus has only a ratio.")
            if kind == SPLIT and self.ratio_new == self.ratio_old:
                raise ValueError("A split with equal parts changes nothing.")
        return self


class TransactionOut(ApiModel):
    id: str
    holding_id: str
    transaction_type: TransactionType
    trade_date: str
    quantity: Amount | None
    price: Amount | None
    fees: Amount
    ratio_new: int | None
    ratio_old: int | None
    notes: str | None
    created_at: str
    # The position straight after this transaction.
    quantity_after: Amount
    cost_basis_after: Amount
    realised_gain: Amount
    cash: Amount


class LotOut(ApiModel):
    acquired: str
    quantity: Amount
    cost: Amount
    origin: Literal["buy", "bonus"]


class SaleLotOut(ApiModel):
    acquired: str
    quantity: Amount
    cost: Amount
    days_held: int


class Valuation(ApiModel):
    """What the units are worth, and where that figure comes from. Never invented."""

    basis: Literal["market_snapshot", "manual", "none"]
    status: Literal["fresh", "stale", "manual", "unavailable", "currency_mismatch"]
    value: Amount | None
    unit_price: Amount | None
    as_of: str | None
    source: str | None
    unrealised_gain: Amount | None
    message: str


class Reconciliation(ApiModel):
    has_ledger: bool
    record_quantity: Amount  # the quantity on the holding record
    ledger_quantity: Amount
    matches: bool
    difference: Amount  # ledger minus record


class PositionOut(ApiModel):
    holding_id: str
    asset_name: str
    symbol: str | None
    quantity: Amount
    cost_basis: Amount
    average_cost: Amount | None
    realised_gain: Amount
    dividends_gross: Amount
    dividends_net: Amount
    fees_paid: Amount
    lots: list[LotOut]
    sales: list[SaleLotOut]
    valuation: Valuation
    reconciliation: Reconciliation
    notes: list[str]


class ApplyLedgerOut(ApiModel):
    quantity: Amount
    purchase_price: Amount  # the total cost basis of the units now held, as the holdings form uses this field
    precision_note: str | None = None
