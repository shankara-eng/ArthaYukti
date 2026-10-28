"""Stock portfolio tracker: requests and results.

Money is a decimal string on the wire. A price the provider could not give is `null` with a status, never 0.
"""

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import Field, model_validator

from app.adapters.stock_provider import SYMBOL_RE
from app.schemas.types import Amount, ApiModel, DecimalStr, IsoDate

Exchange = Literal["NSE", "BSE"]
PriceStatus = Literal["fresh", "stale", "unavailable"]

# Whole shares, bounded: a position is never larger than this and no listed Indian share is priced near the price cap.
Shares = Annotated[DecimalStr, Field(gt=0, le=Decimal("1000000000"), max_digits=12, decimal_places=0)]
PricePerShare = Annotated[DecimalStr, Field(gt=0, le=Decimal("10000000"), max_digits=12, decimal_places=4)]
EARLIEST = date(1990, 1, 1)


def _check_date(value: str | None) -> str | None:
    if value is None:
        return None
    day = date.fromisoformat(value)
    if day < EARLIEST or day > datetime.now(UTC).date():
        raise ValueError("The purchase date must be between 1990 and today.")
    return value


class HoldingCreate(ApiModel):
    """One purchase of a stock, entered by hand. If the stock is already held, this is another purchase of it."""

    symbol: str = Field(min_length=1, max_length=20)
    exchange: Exchange
    company_name: str | None = Field(default=None, max_length=80)
    quantity: Shares
    average_price: PricePerShare
    purchase_date: IsoDate | None = None

    @model_validator(mode="after")
    def _clean(self) -> "HoldingCreate":
        self.symbol = self.symbol.strip().upper()
        if not SYMBOL_RE.match(self.symbol):
            raise ValueError("A symbol is letters and digits (and & or -), with no .NS or .BO suffix.")
        self.company_name = (self.company_name or "").strip() or None
        _check_date(self.purchase_date)
        return self


class HoldingUpdate(ApiModel):
    quantity: Shares | None = None
    average_price: PricePerShare | None = None
    purchase_date: IsoDate | None = None
    company_name: str | None = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def _something(self) -> "HoldingUpdate":
        if all(v is None for v in (self.quantity, self.average_price, self.purchase_date, self.company_name)):
            raise ValueError("Send at least one field to change.")
        _check_date(self.purchase_date)
        return self


class SearchTicker(ApiModel):
    exchange: Exchange
    ticker: str


class SearchResult(ApiModel):
    symbol: str
    company_name: str
    tickers: list[SearchTicker]


class SearchResponse(ApiModel):
    query: str
    results: list[SearchResult]


class PortfolioPosition(ApiModel):
    id: str
    ticker: str
    symbol: str
    exchange: Exchange
    company_name: str
    closed: bool
    quantity: Amount
    purchase_date: str | None  # the date of the first purchase
    purchase_date_entered: bool  # false when no date was given and the day it was added is shown instead
    average_cost: Amount | None
    invested: Amount
    price: Amount | None
    price_status: PriceStatus
    price_fetched_at: str | None
    price_source: str | None
    market_value: Amount | None
    unrealised: Amount | None
    unrealised_pct: Amount | None
    realised: Amount
    dividends: Amount
    weight_pct: Amount | None
    editable: bool  # a single purchase can be edited here; several transactions are managed in the ledger


class Totals(ApiModel):
    open_positions: int
    priced_positions: int
    unpriced_positions: int
    invested_priced: Amount
    invested_unpriced: Amount
    value: Amount
    unrealised: Amount
    unrealised_pct: Amount | None
    realised: Amount
    dividends: Amount
    total_profit: Amount
    total_return_pct: Amount | None
    complete: bool


class Excluded(ApiModel):
    id: str
    name: str
    reason: str


class RefreshInfo(ApiModel):
    status: Literal["ok", "partial", "failed"]
    requested: int
    updated: int
    error_code: str | None
    message: str | None


class PortfolioResponse(ApiModel):
    holdings: list[PortfolioPosition]
    totals: Totals
    excluded: list[Excluded]
    latest_price_at: str | None
    refresh: RefreshInfo | None
    disclaimer: str


class HoldingSaved(ApiModel):
    id: str
    ticker: str
    merged: bool  # true when this was added as another purchase of a stock already held
    verified: bool  # false when the price service could not confirm the symbol (it was saved anyway)
    message: str | None


class SnapshotPoint(ApiModel):
    date: str
    market_value: Amount
    invested: Amount
    complete: bool


class InvestedPoint(ApiModel):
    date: str
    invested: Amount


class HistoryResponse(ApiModel):
    range: str
    since: str | None  # the first recorded value reading, if any
    snapshots: list[SnapshotPoint]
    invested_timeline: list[InvestedPoint]
    note: str
