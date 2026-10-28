"""Market data adapter.

There is no live market feed configured. This module only returns quotes that were stored in the
database by a real data source, and says plainly when a quote is old or missing. It never
invents a price: an unknown or never-fetched symbol is reported as unavailable.
"""

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any, Literal

from sqlalchemy.orm import Session

from app.db.models import MarketDataSnapshot

# A stored quote older than this is reported as stale.
FRESH_FOR = timedelta(hours=24)

QuoteStatus = Literal["fresh", "stale", "unavailable"]


@dataclass(frozen=True)
class MarketQuote:
    symbol: str
    status: QuoteStatus
    price: Decimal | None
    currency: str | None
    asset_type: str | None
    source: str | None
    fetched_at: str | None
    message: str | None
    metadata: dict[str, Any]


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def get_market_quote(symbol: str, db: Session | None = None) -> MarketQuote:
    clean_sym = symbol.upper().strip()
    snapshot = None
    if db is not None:
        snapshot = (
            db.query(MarketDataSnapshot)
            .filter(MarketDataSnapshot.symbol == clean_sym)
            .order_by(MarketDataSnapshot.fetched_at.desc())
            .first()
        )
    if snapshot is None:
        return MarketQuote(
            symbol=clean_sym,
            status="unavailable",
            price=None,
            currency=None,
            asset_type=None,
            source=None,
            fetched_at=None,
            message="No trusted market data source is configured for this symbol.",
            metadata={},
        )

    fetched = _as_utc(snapshot.fetched_at)
    is_stale = datetime.now(UTC) - fetched > FRESH_FOR
    return MarketQuote(
        symbol=snapshot.symbol,
        status="stale" if is_stale else "fresh",
        price=snapshot.price,
        currency=snapshot.currency,
        asset_type=snapshot.asset_type,
        source=snapshot.source,
        fetched_at=fetched.isoformat(),
        message="This quote is more than 24 hours old." if is_stale else None,
        metadata=json.loads(snapshot.metadata_json) if snapshot.metadata_json else {},
    )
