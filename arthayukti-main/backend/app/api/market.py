from typing import Annotated

from fastapi import APIRouter, Depends, Path
from sqlalchemy.orm import Session

from app.adapters.market_data import get_market_quote
from app.api.common import ERROR_RESPONSES
from app.api.deps import get_db
from app.schemas.market import MarketQuoteResponse

router = APIRouter(prefix="/market", tags=["market"], responses=ERROR_RESPONSES)

Symbol = Annotated[str, Path(pattern=r"^[A-Za-z0-9._&\-]{1,30}$")]


@router.get("/quotes/{symbol}", response_model=MarketQuoteResponse)
def get_quote(symbol: Symbol, db: Session = Depends(get_db)) -> MarketQuoteResponse:
    """A stored market quote with its age. If no trusted source has supplied one, the answer is
    status "unavailable" with no price."""
    quote = get_market_quote(symbol, db)
    return MarketQuoteResponse(
        symbol=quote.symbol,
        status=quote.status,
        price=quote.price,
        currency=quote.currency,
        asset_type=quote.asset_type,
        source=quote.source,
        fetched_at=quote.fetched_at,
        message=quote.message,
        metadata=quote.metadata,
    )
