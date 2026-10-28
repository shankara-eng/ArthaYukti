"""Stock portfolio tracker: a person's own Indian stock holdings, valued at the latest available price.

Built on the holdings ledger that already exists (a stock holding with dated buy and sell transactions and FIFO cost
basis) rather than a second set of tables. Every route needs a signed-in person and reads only their own holdings; an id
that belongs to someone else is "not found". Prices come from the price provider through this backend only, are never
taken from the browser, and a price that could not be read is shown as unavailable, never as zero.
"""

import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi import Response as FastResponse
from sqlalchemy.orm import Session

from app import ratelimit
from app.adapters import stock_provider as provider
from app.adapters.market_data import get_market_quote
from app.api.common import AUTH_RESPONSES, VALIDATION_RESPONSES
from app.api.deps import get_current_user, get_db
from app.api.ledger import _replay, _rows
from app.db.models import (
    AssetInvestment,
    AuditLog,
    InvestmentTransaction,
    MarketDataSnapshot,
    PortfolioSnapshot,
    User,
)
from app.engine.ledger import BUY, Position
from app.engine.portfolio import PositionIn, invested_timeline, money, value_portfolio
from app.errors import ApiError
from app.schemas.portfolio import (
    Excluded,
    HistoryResponse,
    HoldingCreate,
    HoldingSaved,
    HoldingUpdate,
    InvestedPoint,
    PortfolioPosition,
    PortfolioResponse,
    RefreshInfo,
    SearchResponse,
    SearchResult,
    SearchTicker,
    SnapshotPoint,
    Totals,
)

router = APIRouter(prefix="/portfolio", tags=["portfolio"], responses=AUTH_RESPONSES)

MAX_HOLDINGS = 200
ZERO = Decimal("0.00")
DISCLAIMER = (
    "Prices come from a free third-party service that relays Yahoo Finance data. They may be delayed, may be missing "
    "outside market hours or for some symbols, and are for information only: not advice and not a basis for trading "
    "decisions. Check official sources. Figures use only the transactions you entered, and leave out taxes, charges you "
    "did not enter as fees, and any split, bonus or dividend you did not record."
)
RANGE_DAYS = {"1m": 31, "3m": 93, "6m": 186, "1y": 366, "all": None}


def _holding(db: Session, user: User, holding_id: str) -> AssetInvestment:
    holding = (
        db.query(AssetInvestment)
        .filter(AssetInvestment.id == holding_id, AssetInvestment.user_id == user.id, AssetInvestment.asset_type == "stock")
        .first()
    )
    if holding is None:
        raise ApiError(404, "not_found", "Holding not found.")
    return holding


def _is_ticker(value: str | None) -> bool:
    return bool(value) and provider.TICKER_RE.match(value.upper()) is not None


def _today() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d")


def _rate_limit(request: Request, bucket: str, user: User, limit: int) -> None:
    ratelimit.enforce(request, bucket, limit, 60, user.id)


def _store_quotes(db: Session, quotes: dict[str, provider.Quote | None]) -> None:
    now = datetime.now(UTC)
    for ticker, quote in quotes.items():
        if quote is None:
            continue
        row = (
            db.query(MarketDataSnapshot)
            .filter(MarketDataSnapshot.symbol == ticker)
            .order_by(MarketDataSnapshot.fetched_at.desc())
            .first()
        )
        meta = json.dumps({"exchange": quote.exchange})
        if row is None:
            db.add(
                MarketDataSnapshot(
                    symbol=ticker,
                    asset_type="equity",
                    price=quote.price,
                    currency="INR",
                    source=provider.source_name(),
                    fetched_at=now,
                    is_stale=False,
                    metadata_json=meta,
                )
            )
        else:
            row.price = quote.price
            row.currency = "INR"
            row.source = provider.source_name()
            row.fetched_at = now
            row.is_stale = False
            row.metadata_json = meta


class _Loaded:
    def __init__(self, holding: AssetInvestment, ticker: str, position: Position, rows: list[InvestmentTransaction]):
        self.holding = holding
        self.ticker = ticker
        self.position = position
        self.rows = rows


def _load(db: Session, user: User) -> tuple[list[_Loaded], list[Excluded]]:
    holdings = (
        db.query(AssetInvestment)
        .filter(AssetInvestment.user_id == user.id, AssetInvestment.asset_type == "stock")
        .order_by(AssetInvestment.asset_name, AssetInvestment.id)
        .all()
    )
    loaded: list[_Loaded] = []
    excluded: list[Excluded] = []
    for h in holdings:
        if not _is_ticker(h.symbol):
            excluded.append(Excluded(id=h.id, name=h.asset_name, reason="It has no NSE or BSE symbol (like RELIANCE.NS), so it cannot be priced here."))
            continue
        rows = _rows(db, h)
        buys = [r for r in rows if r.transaction_type == "buy"]
        if not buys:
            excluded.append(Excluded(id=h.id, name=h.asset_name, reason="No purchase is recorded for it, so what you invested is not known. Add a purchase."))
            continue
        try:
            position = _replay(rows)
        except ApiError:
            excluded.append(Excluded(id=h.id, name=h.asset_name, reason="Its transaction history does not add up (for example a sale of more units than were held). Fix it in the transaction ledger."))
            continue
        loaded.append(_Loaded(h, str(h.symbol).upper(), position, rows))
    return loaded, excluded


def _price_info(db: Session, ticker: str) -> tuple[Decimal | None, str, str | None, str | None]:
    quote = get_market_quote(ticker, db)
    if quote.price is None or quote.status == "unavailable":
        return None, "unavailable", None, None
    if quote.currency not in (None, "INR"):
        return None, "unavailable", None, None
    return quote.price, "fresh" if quote.status == "fresh" else "stale", quote.fetched_at, quote.source


def _build(db: Session, user: User, refresh: RefreshInfo | None = None) -> PortfolioResponse:
    loaded, excluded = _load(db, user)
    info = {item.ticker: _price_info(db, item.ticker) for item in loaded}
    positions = []
    for item in loaded:
        pos = item.position
        bought = sum((-e.cash for e in pos.events if e.type == BUY), ZERO)
        price = info[item.ticker][0]
        positions.append(
            PositionIn(
                id=item.holding.id,
                quantity=pos.quantity,
                cost_basis=pos.cost_basis,
                bought_total=bought,
                realised=pos.realised_gain,
                dividends=pos.dividends_net,
                price=price,
            )
        )
    valued = value_portfolio(positions)
    out: list[PortfolioPosition] = []
    latest: str | None = None
    for item, row in zip(loaded, valued["rows"], strict=True):
        price, status_, fetched, source = info[item.ticker]
        if fetched and (latest is None or fetched > latest):
            latest = fetched
        symbol, exchange = provider.split_ticker(item.ticker)
        first_buy = min((r for r in item.rows if r.transaction_type == "buy"), key=lambda r: (r.trade_date, r.id))
        out.append(
            PortfolioPosition(
                id=item.holding.id,
                ticker=item.ticker,
                symbol=symbol,
                exchange=exchange,  # type: ignore[arg-type]
                company_name=item.holding.asset_name,
                closed=row["closed"],
                quantity=item.position.quantity,
                purchase_date=first_buy.trade_date,
                purchase_date_entered=first_buy.notes != DATE_NOT_ENTERED,
                average_cost=row["average_cost"],
                invested=row["invested"],
                price=price,
                price_status=status_,  # type: ignore[arg-type]
                price_fetched_at=fetched,
                price_source=source,
                market_value=row["market_value"],
                unrealised=row["unrealised"],
                unrealised_pct=row["unrealised_pct"],
                realised=row["realised"],
                dividends=row["dividends"],
                weight_pct=row["weight_pct"],
                editable=len(item.rows) == 1 and item.rows[0].transaction_type == "buy",
            )
        )
    return PortfolioResponse(
        holdings=out,
        totals=Totals(**valued["totals"]),
        excluded=excluded,
        latest_price_at=latest,
        refresh=refresh,
        disclaimer=DISCLAIMER,
    )


DATE_NOT_ENTERED = "Purchase date not entered; the day it was added is shown."


def _record_snapshot(db: Session, user: User, response: PortfolioResponse) -> None:
    totals = response.totals
    if totals.priced_positions < 1:
        return
    today = _today()
    row = db.query(PortfolioSnapshot).filter(PortfolioSnapshot.user_id == user.id, PortfolioSnapshot.snapshot_date == today).first()
    if row is None:
        row = PortfolioSnapshot(user_id=user.id, snapshot_date=today)
        db.add(row)
    row.market_value = totals.value
    row.invested = totals.invested_priced
    row.priced_count = totals.priced_positions
    row.holding_count = totals.open_positions
    row.complete = totals.complete


# ---------------------------------------------------------------------------------------------------------------------


@router.get("/search", response_model=SearchResponse, responses=VALIDATION_RESPONSES)
def search_stocks(
    request: Request,
    q: str = Query(min_length=2, max_length=40),
    user: User = Depends(get_current_user),
) -> SearchResponse:
    """NSE and BSE stocks matching a name or symbol, from the price service. A service failure is an error, not an
    empty list."""
    _rate_limit(request, "portfolio-search", user, 40)
    try:
        hits = provider.search(q)
    except provider.ProviderError as error:
        raise ApiError(502 if error.code != "timeout" else 504, f"market_{error.code}", error.message) from error
    return SearchResponse(
        query=q.strip(),
        results=[
            SearchResult(
                symbol=hit.symbol,
                company_name=hit.company_name,
                tickers=[SearchTicker(exchange="NSE", ticker=hit.symbol + ".NS"), SearchTicker(exchange="BSE", ticker=hit.symbol + ".BO")],
            )
            for hit in hits
        ],
    )


@router.get("", response_model=PortfolioResponse)
def get_portfolio(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> PortfolioResponse:
    """The person's stock positions valued at the latest stored prices, with profit and loss. It does not call the price
    service: use refresh for that."""
    return _build(db, user)


@router.post("/refresh", response_model=PortfolioResponse)
def refresh_portfolio(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PortfolioResponse:
    """Ask the price service for the latest prices of the person's open positions, store what it returned, and value the
    portfolio. If the service fails, the stored prices stay as they were and are shown with their age."""
    _rate_limit(request, "portfolio-refresh", user, 12)
    loaded, _ = _load(db, user)
    open_items = [item for item in loaded if item.position.quantity > 0]
    tickers = sorted({item.ticker for item in open_items})
    if not tickers:
        return _build(db, user, RefreshInfo(status="ok", requested=0, updated=0, error_code=None, message=None))
    try:
        quotes = provider.fetch_quotes(tickers)
    except provider.ProviderError as error:
        return _build(db, user, RefreshInfo(status="failed", requested=len(tickers), updated=0, error_code=error.code, message=error.message))
    _store_quotes(db, quotes)
    updated = sum(1 for q in quotes.values() if q is not None)
    stamp = _today()
    for item in open_items:
        quote = quotes.get(item.ticker)
        if quote is not None:
            item.holding.current_value = money(item.position.quantity * quote.price)  # keeps net worth in step
            item.holding.last_valuation_date = stamp
    db.flush()
    response = _build(db, user, RefreshInfo(
        status="ok" if updated == len(tickers) else "partial",
        requested=len(tickers),
        updated=updated,
        error_code=None if updated == len(tickers) else "no_price",
        message=None if updated == len(tickers) else "The price service had no price for some symbols. They are shown as unavailable.",
    ))
    _record_snapshot(db, user, response)
    db.commit()
    return response


@router.post("/holdings", response_model=HoldingSaved, status_code=status.HTTP_201_CREATED, responses=VALIDATION_RESPONSES)
def add_holding(
    body: HoldingCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> HoldingSaved:
    """Record a purchase of a stock. If it is already held, this is another purchase of it (the ledger works out the
    average cost). Nothing the browser says about prices is stored: only quantity, price paid and date."""
    ticker = provider.make_ticker(body.symbol, body.exchange)
    _rate_limit(request, "portfolio-write", user, 60)
    existing = (
        db.query(AssetInvestment)
        .filter(AssetInvestment.user_id == user.id, AssetInvestment.asset_type == "stock", AssetInvestment.symbol == ticker)
        .first()
    )
    if existing is None and db.query(AssetInvestment).filter(AssetInvestment.user_id == user.id).count() >= MAX_HOLDINGS:
        raise ApiError(409, "holdings_full", f"You can keep up to {MAX_HOLDINGS} holdings.")

    verified, message, company = False, None, body.company_name
    try:
        quotes = provider.fetch_quotes([ticker])
        quote = quotes.get(ticker)
        if quote is None:
            message = f"The price service has no price for {ticker} yet. It was saved: check the symbol and exchange."
        else:
            verified = True
            company = company or quote.company_name
            _store_quotes(db, quotes)
    except provider.ProviderError:
        message = "The price service could not be reached, so the symbol was not checked. It was saved."

    entered = body.purchase_date is not None
    holding = existing
    merged = holding is not None
    if holding is None:
        holding = AssetInvestment(
            user_id=user.id,
            asset_name=company or body.symbol,
            asset_type="stock",
            symbol=ticker,
            quantity=body.quantity,
            purchase_price=money(body.quantity * body.average_price),
            current_value=ZERO,
            is_liquid=True,
        )
        db.add(holding)
        db.flush()
    db.add(
        InvestmentTransaction(
            user_id=user.id,
            holding_id=holding.id,
            transaction_type="buy",
            trade_date=body.purchase_date or _today(),
            quantity=body.quantity,
            price=body.average_price,
            fees=ZERO,
            notes=None if entered else DATE_NOT_ENTERED,
        )
    )
    db.flush()
    position = _replay(_rows(db, holding))
    holding.quantity = position.quantity
    holding.purchase_price = money(position.cost_basis)
    db.add(AuditLog(user_id=user.id, action="PORTFOLIO_HOLDING_ADDED", resource_type="HOLDING", resource_id=holding.id))
    db.commit()
    return HoldingSaved(id=holding.id, ticker=ticker, merged=merged, verified=verified, message=message)


@router.put("/holdings/{holding_id}", response_model=HoldingSaved, responses=VALIDATION_RESPONSES)
def edit_holding(
    holding_id: str,
    body: HoldingUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> HoldingSaved:
    """Change the quantity, price paid, date or name of a holding that has one purchase. A holding with several
    transactions is changed in the transaction ledger, where each one can be edited on its own."""
    holding = _holding(db, user, holding_id)
    rows = _rows(db, holding)
    if len(rows) != 1 or rows[0].transaction_type != "buy":
        raise ApiError(409, "several_transactions", "This holding has more than one transaction. Change it in the transaction ledger.")
    txn = rows[0]
    if body.quantity is not None:
        txn.quantity = body.quantity
    if body.average_price is not None:
        txn.price = body.average_price
    if body.purchase_date is not None:
        txn.trade_date = body.purchase_date
        txn.notes = None
    if body.company_name is not None and body.company_name.strip():
        holding.asset_name = body.company_name.strip()
    db.flush()
    position = _replay(_rows(db, holding))
    holding.quantity = position.quantity
    holding.purchase_price = money(position.cost_basis)
    db.add(AuditLog(user_id=user.id, action="PORTFOLIO_HOLDING_EDITED", resource_type="HOLDING", resource_id=holding.id))
    db.commit()
    return HoldingSaved(id=holding.id, ticker=str(holding.symbol), merged=False, verified=True, message=None)


@router.delete("/holdings/{holding_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_holding(
    holding_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> FastResponse:
    """Remove a holding and its transactions."""
    holding = _holding(db, user, holding_id)
    db.add(AuditLog(user_id=user.id, action="PORTFOLIO_HOLDING_DELETED", resource_type="HOLDING", resource_id=holding.id))
    db.delete(holding)
    db.commit()
    return FastResponse(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/history", response_model=HistoryResponse)
def portfolio_history(
    range: str = Query(default="all", pattern="^(1m|3m|6m|1y|all)$"),  # noqa: A002
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> HistoryResponse:
    """What can honestly be shown over time.

    The price service has no historical prices, so a value history cannot be rebuilt for dates before this feature was
    used. `snapshots` are the readings taken each time prices were refreshed, going forward from the first. The
    `invested_timeline` is real history: what was invested when, from the dated transactions, needing no prices."""
    days = RANGE_DAYS[range]
    cutoff = None if days is None else (datetime.now(UTC) - timedelta(days=days)).strftime("%Y-%m-%d")
    query = db.query(PortfolioSnapshot).filter(PortfolioSnapshot.user_id == user.id)
    first = query.order_by(PortfolioSnapshot.snapshot_date).first()
    if cutoff is not None:
        query = query.filter(PortfolioSnapshot.snapshot_date >= cutoff)
    snaps = query.order_by(PortfolioSnapshot.snapshot_date).all()
    loaded, _ = _load(db, user)
    histories: list[list[tuple[str, Decimal]]] = []
    for item in loaded:
        events = sorted(item.position.events, key=lambda e: e.date)
        histories.append([(e.date, e.cost_basis_after) for e in events])
    timeline = [(d, v) for d, v in invested_timeline(histories) if cutoff is None or d >= cutoff]
    return HistoryResponse(
        range=range,
        since=first.snapshot_date if first else None,
        snapshots=[
            SnapshotPoint(date=s.snapshot_date, market_value=s.market_value, invested=s.invested, complete=bool(s.complete))
            for s in snaps
        ],
        invested_timeline=[InvestedPoint(date=d, invested=v) for d, v in timeline],
        note=(
            "Value history starts at the first reading taken in this app. Earlier prices are not available from the price "
            "service, so no earlier value is shown or guessed."
        ),
    )
