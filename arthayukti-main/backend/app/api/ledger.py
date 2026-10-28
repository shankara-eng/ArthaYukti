"""Holdings ledger: record actual transactions on a holding, see the reconciled position, export, and (only when asked)
copy the reconciled quantity and cost onto the holding record.

Every route is owner-scoped. Nothing here changes the holding record unless `apply-ledger` is called, and nothing here
invents a price: a valuation comes from a stored market snapshot, or from the value the person entered, and says which.
"""

import csv
import io
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.adapters.market_data import get_market_quote
from app.api.common import AUTH_RESPONSES, VALIDATION_RESPONSES
from app.api.deps import get_current_user, get_db
from app.db.models import AssetInvestment, AuditLog, InvestmentTransaction, User
from app.engine.ledger import LedgerError, Position, Txn, paisa, reconcile
from app.errors import ApiError
from app.schemas.ledger import (
    ApplyLedgerOut,
    LotOut,
    PositionOut,
    Reconciliation,
    SaleLotOut,
    TransactionCreate,
    TransactionOut,
    Valuation,
)

router = APIRouter(prefix="/financials/investments", tags=["holdings-ledger"], responses=AUTH_RESPONSES)

ZERO = Decimal("0.00")
# Each request replays the whole history, so a holding carries a bounded number of transactions.
MAX_TRANSACTIONS_PER_HOLDING = 1000


def _holding(db: Session, user: User, holding_id: str) -> AssetInvestment:
    holding = (
        db.query(AssetInvestment)
        .filter(AssetInvestment.id == holding_id, AssetInvestment.user_id == user.id)
        .first()
    )
    if holding is None:
        raise ApiError(404, "not_found", "Holding not found.")
    return holding


def _rows(db: Session, holding: AssetInvestment) -> list[InvestmentTransaction]:
    return (
        db.query(InvestmentTransaction)
        .filter(InvestmentTransaction.holding_id == holding.id)
        .order_by(InvestmentTransaction.trade_date, InvestmentTransaction.created_at, InvestmentTransaction.id)
        .all()
    )


def _txn(row: InvestmentTransaction) -> Txn:
    return Txn(
        id=row.id,
        type=row.transaction_type,
        date=row.trade_date,
        quantity=Decimal(str(row.quantity)) if row.quantity is not None else None,
        price=Decimal(str(row.price)) if row.price is not None else None,
        fees=Decimal(str(row.fees)),
        ratio_new=row.ratio_new,
        ratio_old=row.ratio_old,
    )


def _replay(rows: list[InvestmentTransaction]) -> Position:
    try:
        return reconcile([_txn(row) for row in rows])
    except LedgerError as error:
        raise ApiError(422, "ledger_invalid", str(error)) from None


def _out(row: InvestmentTransaction, position: Position) -> TransactionOut:
    event = next(e for e in position.events if e.txn_id == row.id)
    return TransactionOut(
        id=row.id,
        holding_id=row.holding_id,
        transaction_type=row.transaction_type,
        trade_date=row.trade_date,
        quantity=row.quantity,
        price=row.price,
        fees=row.fees,
        ratio_new=row.ratio_new,
        ratio_old=row.ratio_old,
        notes=row.notes,
        created_at=row.created_at.isoformat(),
        quantity_after=event.quantity_after,
        cost_basis_after=event.cost_basis_after,
        realised_gain=event.realised_gain,
        cash=event.cash,
    )


@router.post(
    "/{holding_id}/transactions",
    response_model=TransactionOut,
    status_code=status.HTTP_201_CREATED,
    responses=VALIDATION_RESPONSES,
)
def add_transaction(
    holding_id: str,
    body: TransactionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TransactionOut:
    """Record one transaction. The whole history is replayed first: a sale of units that were not held, or a
    split on an empty position, is refused and nothing is saved."""
    holding = _holding(db, user, holding_id)
    if db.query(InvestmentTransaction).filter(InvestmentTransaction.holding_id == holding.id).count() >= MAX_TRANSACTIONS_PER_HOLDING:
        raise ApiError(409, "ledger_full", f"A holding can carry at most {MAX_TRANSACTIONS_PER_HOLDING} transactions.")
    row = InvestmentTransaction(
        user_id=user.id,
        holding_id=holding.id,
        transaction_type=body.transaction_type,
        trade_date=body.trade_date,
        quantity=body.quantity,
        price=body.price,
        fees=body.fees,
        ratio_new=body.ratio_new,
        ratio_old=body.ratio_old,
        notes=body.notes,
    )
    db.add(row)
    db.flush()
    rows = _rows(db, holding)
    try:
        position = _replay(rows)
    except ApiError:
        db.rollback()
        raise
    db.add(AuditLog(user_id=user.id, action="HOLDING_TRANSACTION_ADDED", resource_type="HOLDING", resource_id=holding.id))
    db.commit()
    db.refresh(row)
    return _out(row, position)


@router.get("/{holding_id}/transactions", response_model=list[TransactionOut])
def list_transactions(
    holding_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> list[TransactionOut]:
    """The recorded transactions in the order they are replayed, each with the position after it."""
    holding = _holding(db, user, holding_id)
    rows = _rows(db, holding)
    position = _replay(rows)
    return [_out(row, position) for row in rows]


@router.delete("/{holding_id}/transactions/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(
    holding_id: str,
    transaction_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """Remove a transaction, unless the rest of the history would then stop making sense (for example deleting a
    purchase that later sales depend on)."""
    holding = _holding(db, user, holding_id)
    rows = _rows(db, holding)
    target = next((r for r in rows if r.id == transaction_id), None)
    if target is None:
        raise ApiError(404, "not_found", "Transaction not found.")
    try:
        reconcile([_txn(r) for r in rows if r.id != transaction_id])
    except LedgerError as error:
        raise ApiError(409, "ledger_conflict", f"This transaction cannot be removed: {error}") from None
    db.delete(target)
    db.add(AuditLog(user_id=user.id, action="HOLDING_TRANSACTION_DELETED", resource_type="HOLDING", resource_id=holding.id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _valuation(db: Session, holding: AssetInvestment, position: Position) -> Valuation:
    quantity = position.quantity
    if holding.symbol:
        quote = get_market_quote(holding.symbol, db)
        if quote.price is not None:
            if quote.currency not in (None, "INR"):
                return Valuation(
                    basis="none",
                    status="currency_mismatch",
                    value=None,
                    unit_price=None,
                    as_of=quote.fetched_at,
                    source=quote.source,
                    unrealised_gain=None,
                    message=f"The stored price is in {quote.currency}, not rupees, so it is not used to value this holding.",
                )
            value = paisa(quantity * quote.price)
            return Valuation(
                basis="market_snapshot",
                status="fresh" if quote.status == "fresh" else "stale",
                value=value,
                unit_price=quote.price,
                as_of=quote.fetched_at,
                source=quote.source,
                unrealised_gain=value - position.cost_basis,
                message=(
                    "Valued at the latest stored price."
                    if quote.status == "fresh"
                    else "Valued at the last stored price, which is old. Treat it as out of date."
                ),
            )
    manual = Decimal(str(holding.current_value))
    if manual > 0:
        return Valuation(
            basis="manual",
            status="manual",
            value=manual,
            unit_price=None,
            as_of=holding.last_valuation_date,
            source="entered by you",
            unrealised_gain=manual - position.cost_basis,
            message="Valued at the value you entered on the holding. It is not linked to the units in the ledger.",
        )
    return Valuation(
        basis="none",
        status="unavailable",
        value=None,
        unit_price=None,
        as_of=None,
        source=None,
        unrealised_gain=None,
        message="No stored price and no value entered, so there is no valuation and no unrealised gain.",
    )


@router.get("/{holding_id}/position", response_model=PositionOut)
def position(holding_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> PositionOut:
    """Units, cost basis, realised gain and dividends from the recorded transactions, and a valuation that says
    where its figure comes from."""
    holding = _holding(db, user, holding_id)
    rows = _rows(db, holding)
    pos = _replay(rows)
    record = Decimal(str(holding.quantity))
    difference = pos.quantity - record
    notes = [
        "These figures are replayed from the transactions you recorded, first in first out.",
        "No tax is calculated here. The days each sold lot was held are shown so a tax rule can use them.",
    ]
    if not rows:
        notes.append("No transactions are recorded yet, so the position is empty and the holding record is unchanged.")
    return PositionOut(
        holding_id=holding.id,
        asset_name=holding.asset_name,
        symbol=holding.symbol,
        quantity=pos.quantity,
        cost_basis=pos.cost_basis,
        average_cost=pos.average_cost,
        realised_gain=pos.realised_gain,
        dividends_gross=pos.dividends_gross,
        dividends_net=pos.dividends_net,
        fees_paid=pos.fees_paid,
        lots=[LotOut(acquired=lot.acquired, quantity=lot.quantity, cost=lot.cost, origin=lot.origin) for lot in pos.lots],  # type: ignore[arg-type]
        sales=[SaleLotOut(acquired=s.acquired, quantity=s.quantity, cost=s.cost, days_held=s.days_held) for s in pos.sales],
        valuation=_valuation(db, holding, pos),
        reconciliation=Reconciliation(
            has_ledger=bool(rows),
            record_quantity=record,
            ledger_quantity=pos.quantity,
            matches=bool(rows) and difference == 0,
            difference=difference,
        ),
        notes=notes,
    )


@router.get("/{holding_id}/ledger.csv", response_class=Response)
def ledger_csv(holding_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Response:
    """The ledger as CSV (UTF-8 with a byte-order mark for Excel), with the running position after each line."""
    holding = _holding(db, user, holding_id)
    rows = _rows(db, holding)
    pos = _replay(rows)
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(["Date", "Type", "Quantity", "Price per unit", "Fees", "Ratio (new:old)", "Units after", "Cost basis after", "Realised gain", "Cash", "Notes"])
    for row in rows:
        event = next(e for e in pos.events if e.txn_id == row.id)
        ratio = f"{row.ratio_new}:{row.ratio_old}" if row.ratio_new else ""
        writer.writerow(
            [
                row.trade_date,
                row.transaction_type,
                "" if row.quantity is None else f"{Decimal(str(row.quantity)):f}",
                "" if row.price is None else f"{Decimal(str(row.price)):f}",
                f"{Decimal(str(row.fees)):.2f}",
                ratio,
                f"{event.quantity_after:f}",
                f"{event.cost_basis_after:.2f}",
                f"{event.realised_gain:.2f}",
                f"{event.cash:.2f}",
                row.notes or "",
            ]
        )
    return Response(
        content="﻿" + out.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="arthayukti_holding_ledger.csv"'},
    )


@router.post("/{holding_id}/apply-ledger", response_model=ApplyLedgerOut)
def apply_ledger(holding_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> ApplyLedgerOut:
    """Copy the reconciled units and total cost basis onto the holding record. Only on request: the value the
    person entered for the holding is never touched, so net worth does not move."""
    holding = _holding(db, user, holding_id)
    rows = _rows(db, holding)
    if not rows:
        raise ApiError(409, "ledger_empty", "There are no recorded transactions to apply.")
    pos = _replay(rows)
    quantity = pos.quantity.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)  # the record keeps 4 decimals
    holding.quantity = quantity
    holding.purchase_price = pos.cost_basis  # the holdings form uses this field as the amount invested
    db.add(AuditLog(user_id=user.id, action="HOLDING_LEDGER_APPLIED", resource_type="HOLDING", resource_id=holding.id))
    db.commit()
    note = None
    if quantity != pos.quantity:
        note = "The holding record keeps four decimals, so the units were rounded."
    return ApplyLedgerOut(quantity=quantity, purchase_price=pos.cost_basis, precision_note=note)
