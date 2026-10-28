"""Indian stock prices from the Indian-Stock-Market-API (https://github.com/0xramm/Indian-Stock-Market-API).

What that service actually offers (read from its README and source, not assumed):

- `GET /search?q=` finds NSE/BSE symbols by name. A miss is HTTP 404 with `{"status": "error", ...}`.
- `GET /stock/list?symbols=A.NS,B.BO&res=num` gives the latest price for several symbols in one call. A symbol it cannot
  price comes back as an entry with `"error": "No data available"`. This entry has no market timestamp.
- There is no historical-price endpoint, no stated rate limit and no stated error contract beyond the above.
- It is a thin layer over unofficial Yahoo Finance endpoints. Its own disclaimer says the data is for educational
  purposes only and not for financial decisions; prices can be delayed, and are stale outside market hours.

So this module never invents a price. Anything it cannot read as a finite number above zero is "no price", the caller
shows it as unavailable, and a recent failure backs the provider off for a short while instead of hammering it.
Only symbols go out; no user data is ever sent.
"""

import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from app.config import settings

MAX_RESPONSE_BYTES = 1_000_000
MAX_BATCH = 40
QUOTE_TTL_SECONDS = 60.0
SEARCH_TTL_SECONDS = 600.0
BACKOFF_SECONDS = 30.0
MAX_PRICE = Decimal("10000000")  # no listed Indian share is priced near this; anything above is a bad reading

SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9&\-]{0,19}$")
TICKER_RE = re.compile(r"^[A-Z0-9][A-Z0-9&\-]{0,19}\.(NS|BO)$")
EXCHANGE_SUFFIX = {"NSE": ".NS", "BSE": ".BO"}
SUFFIX_EXCHANGE = {".NS": "NSE", ".BO": "BSE"}

YAHOO_BASE = "https://query1.finance.yahoo.com"
SOURCE_NAME = "Indian-Stock-Market-API (Yahoo Finance)"
YAHOO_SOURCE_NAME = "Yahoo Finance (public quote endpoint)"


def source_name() -> str:
    return YAHOO_SOURCE_NAME if settings.MARKET_PROVIDER == "yahoo" else SOURCE_NAME


class ProviderError(Exception):
    """The provider could not give a usable answer. `code` is stable for the API and the UI."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Quote:
    ticker: str
    symbol: str
    exchange: str
    company_name: str | None
    price: Decimal
    market_date: str | None  # the provider's own date for the price, when it gives one (the batch call does not)


@dataclass(frozen=True)
class SearchHit:
    symbol: str
    company_name: str


def make_ticker(symbol: str, exchange: str) -> str:
    """`RELIANCE` + `NSE` -> `RELIANCE.NS`. Refuses anything that is not a plain exchange symbol."""
    clean = symbol.strip().upper()
    if exchange not in EXCHANGE_SUFFIX:
        raise ValueError("The exchange must be NSE or BSE.")
    if not SYMBOL_RE.match(clean):
        raise ValueError("A symbol is letters and digits (and & or -), up to 20 characters, with no exchange suffix.")
    return clean + EXCHANGE_SUFFIX[exchange]


def split_ticker(ticker: str) -> tuple[str, str]:
    if not TICKER_RE.match(ticker):
        raise ValueError("Not a valid NSE or BSE ticker.")
    return ticker[:-3], SUFFIX_EXCHANGE[ticker[-3:]]


# ---------------------------------------------------------------------------------------------------------------------
# One HTTP GET, as small as possible. Tests replace `_http_get`.

_lock = threading.Lock()
_quote_cache: dict[str, tuple[float, Quote]] = {}
_search_cache: dict[str, tuple[float, list[SearchHit]]] = {}
_failed_at: float | None = None


def reset_for_tests() -> None:
    global _failed_at
    with _lock:
        _quote_cache.clear()
        _search_cache.clear()
        _failed_at = None


def _http_get(path: str, params: dict[str, str]) -> tuple[int, Any]:
    base = YAHOO_BASE if settings.MARKET_PROVIDER == "yahoo" else settings.MARKET_API_BASE_URL
    url = f"{base}{path}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "ArthaYukti/1.0"})  # noqa: S310
    try:
        with urllib.request.urlopen(request, timeout=settings.MARKET_API_TIMEOUT_SECONDS) as response:  # noqa: S310
            status = response.status
            body = response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as error:
        status = error.code
        body = error.read(MAX_RESPONSE_BYTES + 1)
    except TimeoutError as error:
        raise ProviderError("timeout", "The price service did not answer in time.") from error
    except (urllib.error.URLError, OSError) as error:
        if isinstance(getattr(error, "reason", None), TimeoutError):
            raise ProviderError("timeout", "The price service did not answer in time.") from error
        raise ProviderError("unavailable", "The price service could not be reached.") from error
    if len(body) > MAX_RESPONSE_BYTES:
        raise ProviderError("bad_response", "The price service sent an unexpectedly large answer.")
    try:
        return status, json.loads(body.decode("utf-8")) if body else None
    except (ValueError, UnicodeDecodeError) as error:
        raise ProviderError("bad_response", "The price service sent something that is not valid JSON.") from error


def _guard() -> None:
    """After a failure, wait a little before asking again: fail fast rather than queue slow requests."""
    with _lock:
        if _failed_at is not None and time.monotonic() - _failed_at < BACKOFF_SECONDS:
            raise ProviderError("unavailable", "The price service failed a moment ago. Try again shortly.")


def _call(path: str, params: dict[str, str]) -> tuple[int, Any]:
    global _failed_at
    _guard()
    try:
        result = _http_get(path, params)
    except ProviderError:
        with _lock:
            _failed_at = time.monotonic()
        raise
    status = result[0]
    if status >= 500 or status == 429:
        with _lock:
            _failed_at = time.monotonic()
        raise ProviderError("unavailable", "The price service is not available right now.")
    with _lock:
        _failed_at = None
    return result


# ---------------------------------------------------------------------------------------------------------------------
# Reading answers strictly


def _price(value: Any) -> Decimal | None:
    """A price only if it is a real number above zero. 'N/A', None, booleans, NaN, infinities and absurd values are not."""
    if value is None or isinstance(value, bool) or not isinstance(value, int | float | str):
        return None
    try:
        number = Decimal(str(value).strip())
    except InvalidOperation:
        return None
    if not number.is_finite() or number <= 0 or number > MAX_PRICE:
        return None
    return number.quantize(Decimal("0.01"))


def _text(value: Any, limit: int = 80) -> str | None:
    return value.strip()[:limit] if isinstance(value, str) and value.strip() and value.strip() != "N/A" else None


def _yahoo_search(query: str) -> list[SearchHit]:
    status, body = _call("/v1/finance/search", {"q": query.strip(), "quotesCount": "15", "newsCount": "0"})
    if status != 200 or not isinstance(body, dict) or not isinstance(body.get("quotes"), list):
        raise ProviderError("bad_response", "The price service answered search in an unexpected way.")
    results: list[SearchHit] = []
    seen: set[str] = set()
    for item in body["quotes"]:
        if not isinstance(item, dict) or item.get("quoteType") not in ("EQUITY", "ETF"):
            continue
        ticker = item.get("symbol")
        if not isinstance(ticker, str) or not TICKER_RE.match(ticker.upper()):
            continue
        symbol = ticker.upper()[:-3]
        if symbol in seen:
            continue
        seen.add(symbol)
        results.append(SearchHit(symbol, _text(item.get("longname")) or _text(item.get("shortname")) or symbol))
    return results


def _yahoo_quote(ticker: str) -> Quote | None:
    status, body = _call(f"/v8/finance/chart/{urllib.parse.quote(ticker)}", {"range": "1d", "interval": "1d"})
    if status == 404:
        return None
    if status != 200 or not isinstance(body, dict):
        raise ProviderError("bad_response", "The price service answered in an unexpected way.")
    chart = body.get("chart")
    result = chart.get("result") if isinstance(chart, dict) else None
    meta = result[0].get("meta") if isinstance(result, list) and result and isinstance(result[0], dict) else None
    if not isinstance(meta, dict) or meta.get("symbol") != ticker:  # never trust a symbol we did not ask about
        return None
    price = _price(meta.get("regularMarketPrice"))
    if price is None:
        return None
    moment = meta.get("regularMarketTime")
    market_date = None
    if isinstance(moment, int) and not isinstance(moment, bool) and 0 < moment < 4_102_444_800:
        market_date = datetime.fromtimestamp(moment, UTC).date().isoformat()
    symbol, exchange = split_ticker(ticker)
    return Quote(ticker, symbol, exchange, _text(meta.get("longName")) or _text(meta.get("shortName")), price, market_date)


def search(query: str) -> list[SearchHit]:
    """Companies matching a name or symbol. A provider 'no results' answer is an empty list, not an error."""
    key = query.strip().lower()
    now = time.monotonic()
    with _lock:
        hit = _search_cache.get(key)
        if hit and now - hit[0] < SEARCH_TTL_SECONDS:
            return hit[1]
    if settings.MARKET_PROVIDER == "yahoo":
        found = _yahoo_search(query)
        with _lock:
            _search_cache[key] = (now, found)
        return found[:15]
    status, body = _call("/search", {"q": query.strip()})
    if status == 404:
        results: list[SearchHit] = []
    elif status == 200 and isinstance(body, dict) and isinstance(body.get("results"), list):
        results = []
        seen: set[str] = set()
        for item in body["results"]:
            if not isinstance(item, dict):
                continue
            symbol = item.get("symbol")
            if not isinstance(symbol, str) or not SYMBOL_RE.match(symbol.strip().upper()):
                continue
            symbol = symbol.strip().upper()
            if symbol in seen:
                continue
            seen.add(symbol)
            results.append(SearchHit(symbol, _text(item.get("company_name")) or symbol))
    else:
        raise ProviderError("bad_response", "The price service answered search in an unexpected way.")
    with _lock:
        _search_cache[key] = (now, results)
    return results[:15]


def fetch_quotes(tickers: list[str]) -> dict[str, Quote | None]:
    """Latest price for each ticker. A ticker the provider cannot price maps to None. Raises ProviderError when the
    provider as a whole fails (so the caller can tell 'no price for this one' from 'service down')."""
    wanted = list(dict.fromkeys(tickers))
    for ticker in wanted:
        if not TICKER_RE.match(ticker):
            raise ValueError(f"Not a valid NSE or BSE ticker: {ticker}")
    now = time.monotonic()
    out: dict[str, Quote | None] = {}
    missing: list[str] = []
    with _lock:
        for ticker in wanted:
            cached = _quote_cache.get(ticker)
            if cached and now - cached[0] < QUOTE_TTL_SECONDS:
                out[ticker] = cached[1]
            else:
                missing.append(ticker)
    if settings.MARKET_PROVIDER == "yahoo":
        # Yahoo prices one symbol per request, so ask a few at a time. A failure of the service as a whole raises.
        with ThreadPoolExecutor(max_workers=6) as pool:
            fetched = list(pool.map(_yahoo_quote, missing))
        with _lock:
            stamp = time.monotonic()
            for ticker, quote in zip(missing, fetched, strict=True):
                out[ticker] = quote
                if quote is not None:
                    _quote_cache[ticker] = (stamp, quote)
        return {ticker: out.get(ticker) for ticker in wanted}
    for start in range(0, len(missing), MAX_BATCH):
        batch = missing[start : start + MAX_BATCH]
        status, body = _call("/stock/list", {"symbols": ",".join(batch), "res": "num"})
        if status != 200 or not isinstance(body, dict) or body.get("status") != "success" or not isinstance(body.get("stocks"), list):
            raise ProviderError("bad_response", "The price service answered in an unexpected way.")
        got: dict[str, Quote] = {}
        for item in body["stocks"]:
            if not isinstance(item, dict):
                continue
            ticker = item.get("ticker")
            if ticker not in batch:  # never trust a symbol we did not ask about
                continue
            price = _price(item.get("last_price"))
            if price is None or "error" in item:
                continue
            symbol, exchange = split_ticker(ticker)
            got[ticker] = Quote(ticker, symbol, exchange, _text(item.get("company_name")), price, None)
        with _lock:
            stamp = time.monotonic()
            for ticker in batch:
                quote = got.get(ticker)
                if quote is not None:
                    _quote_cache[ticker] = (stamp, quote)
        for ticker in batch:
            out[ticker] = got.get(ticker)
    return {ticker: out.get(ticker) for ticker in wanted}
