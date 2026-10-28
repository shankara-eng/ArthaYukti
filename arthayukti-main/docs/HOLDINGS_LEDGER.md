# Holdings ledger

Actual, past transactions on a holding (a stock, a mutual fund, gold, anything in Assets & investments): purchases, sales, splits,
bonus units and dividends. The position, cost basis and gains are worked out from them. Nothing here is a forecast: assumed returns
live in the calculators, and a transaction dated in the future is refused.

## What is stored

Table `investment_transactions` (migration `a7b8c9d0e1f2`, new table only): `holding_id` (cascade delete), `user_id`,
`transaction_type`, `trade_date` (YYYY-MM-DD), `quantity` (up to 6 decimals, for fractional mutual-fund units), `price` (4 decimals;
per unit, and for a dividend the amount per unit), `fees`, `ratio_new`/`ratio_old`, `notes`. A holding with no transactions behaves
exactly as before. Lots are *computed* by replaying the transactions, not stored.

## Rules (see `engine/ledger.py`)

- Replay order: by date, then by the order recorded. A back-dated entry slots into place and the whole history is re-checked.
- **Buy**: cost = quantity × price + fees, rounded half-up to the paisa. **Sell**: first in, first out. A partly sold lot gives up a
  proportional share of its cost (rounded half-up); the rest stays in the lot, so cost bought = cost sold + cost still held.
  Proceeds = quantity × price − fees; realised gain = proceeds − cost sold. Selling more than is held on that date is refused.
- **Split (new : old)**: every lot's quantity × new/old, total cost unchanged (cost per unit falls). **Bonus (new : old)**: a new lot
  of held × new/old units at no cost, dated on the bonus date. Quantities round half-up to 6 places; no cash-in-lieu is modelled.
- **Dividend**: units held on the date × amount per unit, less charges or tax withheld. It never changes units or cost basis.
- The days each sold lot was held are reported so that a tax rule can use them. **No tax is calculated.**
- Deleting a transaction that later ones depend on (for example a purchase that a later sale needs) is refused (409).

## Valuation never invents a price

`GET …/position` values the units from, in order: the latest **stored market snapshot** for the holding's symbol (marked `fresh`
or `stale`, with its date and source; a price in another currency is not used); otherwise the **value the person entered** on the
holding (marked as theirs and not linked to the ledger); otherwise **no valuation** and no unrealised gain. There is no live market
feed in this repository, so snapshots exist only if something stores them; a holding with no symbol is valued by the entered value.

## Reconciliation and applying

`position` compares the ledger's units with the quantity on the holding record and reports the difference. It changes nothing.
`POST …/apply-ledger` (explicit, on request) copies the reconciled units (rounded to the record's 4 decimals, with a note when
rounded) and the **total cost basis** onto the record's quantity and purchase price (the holdings form uses that field as the amount
invested). It never touches the value the person entered, so net worth does not move.

## Endpoints (all owner-scoped)

`POST/GET /financials/investments/{id}/transactions`, `DELETE …/transactions/{tid}`, `GET …/position`, `GET …/ledger.csv`,
`POST …/apply-ledger`. The data export includes the transactions; deleting the account or the holding removes them.

## Hand-checked example (tested)

Buy 100 @ 50 + 100 fees (cost 5,100); buy 50 @ 60 + 50 (3,050); 2-for-1 split (300 units, cost 8,150); dividend 2 a unit with 60
withheld (540 net); 1-for-10 bonus (+30 units); sell 250 @ 40 − 80 fees: proceeds 9,920; FIFO cost sold 5,100 + 3,050 × 50/100 = 6,625;
realised gain 3,295.00; left 80 units, cost 1,525.00, average 19.0625. The live API reproduced these figures exactly.

## Not built

Switches and mergers, reinvested dividends as lots, foreign-currency FX, persisted lots and a tax-lot table, per-instrument master
data (ISIN or scheme code), a market-data provider and refresh, XLSX import of transactions.
