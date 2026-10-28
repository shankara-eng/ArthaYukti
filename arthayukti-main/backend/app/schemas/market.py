from typing import Any, Literal

from app.schemas.types import Amount, ApiModel


class MarketQuoteResponse(ApiModel):
    """A stored quote with its freshness, or an explicit "unavailable". Never an invented price."""

    symbol: str
    status: Literal["fresh", "stale", "unavailable"]
    price: Amount | None
    currency: str | None
    asset_type: str | None
    source: str | None
    fetched_at: str | None
    message: str | None
    metadata: dict[str, Any]
