# Stock portfolio tracker

A person's own Indian stock holdings, valued at the latest price the server could fetch. Lives under **Equities > Stock
portfolio**. Holdings are entered by hand: nothing is read from a broker.

## Price provider (verified, not assumed)

Source: <https://github.com/0xramm/Indian-Stock-Market-API> (MIT), read from its README and `src/*.js`. It is a thin
layer over **unofficial Yahoo Finance endpoints**; its own disclaimer says the data is for educational purposes and not
for financial decisions.

| Endpoint used | Purpose | Notes |
| --- | --- | --- |
| `GET /search?q=` | find NSE/BSE symbols | no match is HTTP 404 `{"status":"error"}` |
| `GET /stock/list?symbols=A.NS,B.BO&res=num` | latest price for several symbols in one call | an unpriced symbol is an entry with `"error"`; no market timestamp in this answer |

Not used: `GET /stock` (one symbol; its `last_update` is a date only), `GET /symbols`, `GET /`.
**There is no historical-price endpoint**, no stated rate limit and no documented error contract.

The published address `http://65.0.104.9` is plain HTTP on a bare IP and **was not reachable** when this was written
(TCP port 80 did not connect; every request timed out). Set `MARKET_API_BASE_URL` (and optionally
`MARKET_API_TIMEOUT_SECONDS`, default 8) to an instance you run, ideally behind HTTPS (the repository is a Cloudflare
Worker). Only symbols are sent; no user data. The browser never calls the provider.

## Behaviour

- Prices are fetched by the backend (`app/adapters/stock_provider.py`): strict parsing (a price must be a finite number above
  zero and below ₹1 crore; `N/A`, null, NaN, negatives and absurd values are "no price"), symbols not asked for are ignored,
  a 60 s in-process quote cache, a 10 min search cache, batches of at most 40, a 1 MB response cap, an 8 s timeout, and a 30 s
  back-off after a failure so a down provider fails fast. Per-user limits: 12 refreshes, 40 searches, 60 writes a minute.
- A failed fetch never becomes a zero price. The last stored price stays, shown with when it was fetched; older than 24 h is
  marked **stale**; none at all is **unavailable**, left out of value and return and reported with how much money is
  invested in such holdings.
- Prices are stored in the existing `market_data_snapshots` table (shared public rows, one per ticker). A refresh also updates the
  holding's `current_value` so net worth stays in step.

## Data model (extends what exists)

- A holding is an `assets_investments` row (`asset_type = stock`, `symbol` = `RELIANCE.NS` or `.BO`) with dated buy/sell
  transactions in `investment_transactions`: the existing FIFO ledger. Adding the same stock again is another purchase.
- New table `portfolio_snapshots` (migration `b8c9d0e1f2a3`, additive only): at most one dated value reading per person per day,
  written when a refresh succeeds.
- Stock holdings that have no symbol, no purchase, or a ledger that does not add up are listed as "Not in the portfolio" with the
  reason, never silently dropped.

## Calculations (`app/engine/portfolio.py`)

Invested = cost basis of the units still held (FIFO, including recorded buy fees). Value = quantity x latest price. Unrealised =
value - invested; unrealised % = unrealised / invested x 100 (none if invested is 0). Realised = profit booked on sales (ledger),
counted separately so a gain is never counted twice. Totals are sums over positions; **returns are total profit over total money,
never an average of percentages**. Totals of value and unrealised cover only priced positions, and say how many.
Total return % = (unrealised + realised + dividends) / money paid to buy, over priced and fully-sold positions.

**Not included:** taxes; brokerage or other charges not entered as transaction fees; splits, bonus units and dividends you did not
record in the ledger; inflation.

## History

Today's prices cannot show past performance, and the provider has no history, so nothing is reconstructed or invented:

- **Amount invested over time**: real, from the dated purchases and sales (needs no prices).
- **Value readings**: one per day from the first successful refresh, labelled "since DATE". A value line is drawn only with at
  least two complete readings (every open position priced); incomplete days are listed but left off the line.

## API

All need sign-in and are owner-scoped (another person's id is 404): `GET /portfolio/search?q=`, `GET /portfolio`,
`POST /portfolio/refresh`, `POST /portfolio/holdings`, `PUT /portfolio/holdings/{id}` (single-purchase holdings only; others
are changed in the ledger), `DELETE /portfolio/holdings/{id}`, `GET /portfolio/history?range=1m|3m|6m|1y|all`. A client-supplied
price, value or user id is rejected (422).

## Run and test

```bash
# a provider you run, or leave unset to use the published address (currently unreachable)
export MARKET_API_BASE_URL=https://your-provider.example
cd backend && alembic upgrade head && uvicorn app.main:app --port 8000   # applies b8c9d0e1f2a3
cd frontend && npm run dev
```

Open **Equities > Stock portfolio**: search "reliance", pick NSE, enter shares, price and date, add, then **Refresh prices**.
Tests: `cd backend && pytest tests/test_portfolio_engine.py tests/test_stock_provider.py tests/api/test_portfolio_api.py` and
`cd frontend && npx vitest run src/lib/portfolio.test.ts src/pages/app/StockPortfolio.test.tsx`. All external calls are mocked
(the adapter's HTTP layer is also tested against a local server).

## Update: Yahoo Finance mode (live prices)

The published provider address did not answer, so the adapter has a second mode: `MARKET_PROVIDER=yahoo` reads Yahoo Finance's public
quote endpoints directly (`/v1/finance/search`, `/v8/finance/chart/{ticker}`), the same unofficial upstream the other service wraps.
It prices one symbol per request (a few at a time), keeps the same strictness (a price is a finite number above zero; an answer for
a symbol that was not asked for is refused), the same caches and the same back-off (a 429 or 5xx stops further calls for 30 s). The price
date is the provider's own market time. The default stays `indian_api`; set `MARKET_PROVIDER=yahoo` in `backend/.env` (done locally).
Verified live: RELIANCE.NS, TCS.NS and INFY.BO returned prices dated 2026-10-23 (the last close), and an unknown symbol returned none.
Yahoo's data is unofficial, can be delayed, and carries its own terms; it is for planning, not financial decisions.
