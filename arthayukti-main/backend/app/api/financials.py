import csv
import io
import itertools
import uuid
from datetime import date
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.api.common import AUTH_RESPONSES
from app.api.deps import get_current_user, get_db
from app.db.models import (
    AssetInvestment,
    FinancialAccount,
    FinancialTransaction,
    Liability,
    User,
)
from app.engine.investments import calculate_sip_projection
from app.errors import ApiError
from app.schemas.financials import (
    AccountCreateRequest,
    AccountResponse,
    AccountUpdateRequest,
    CSVImportResponse,
    InvestmentCreateRequest,
    InvestmentResponse,
    InvestmentUpdateRequest,
    LiabilityCreateRequest,
    LiabilityResponse,
    LiabilityUpdateRequest,
    NetWorthResponse,
    TransactionCreateRequest,
    TransactionResponse,
    TransferCreateRequest,
    TransferResponse,
)
from app.schemas.investments import SipProjectionRequest, SipProjectionResponse
from app.schemas.types import MAX_MONEY

router = APIRouter(prefix="/financials", tags=["financials"], responses=AUTH_RESPONSES)


# =========================================================================
# Accounts
# =========================================================================


@router.post("/accounts", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
def create_account(
    req: AccountCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AccountResponse:
    """Create a new financial account (savings, checking, deposit, brokerage, etc.)."""
    owner = user
    acc = FinancialAccount(
        id=str(uuid.uuid4()),
        user_id=owner.id,
        account_name=req.account_name,
        account_type=req.account_type,
        balance=req.balance,
        currency=req.currency,
        is_liquid=req.is_liquid,
        institution_name=req.institution_name,
        notes=req.notes,
    )
    db.add(acc)
    db.commit()
    db.refresh(acc)
    return _to_account_response(acc)


@router.get("/accounts", response_model=list[AccountResponse])
def list_accounts(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AccountResponse]:
    """List all accounts for the current user."""
    owner = user
    accounts = (
        db.query(FinancialAccount)
        .filter(FinancialAccount.user_id == owner.id)
        .order_by(FinancialAccount.created_at.desc())
        .all()
    )
    return [_to_account_response(a) for a in accounts]


@router.get("/accounts/{account_id}", response_model=AccountResponse)
def get_account(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AccountResponse:
    """Get a specific account by ID."""
    owner = user
    acc = (
        db.query(FinancialAccount)
        .filter(FinancialAccount.id == account_id, FinancialAccount.user_id == owner.id)
        .first()
    )
    if acc is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return _to_account_response(acc)


@router.put("/accounts/{account_id}", response_model=AccountResponse)
def update_account(
    account_id: str,
    req: AccountUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AccountResponse:
    """Update an existing financial account."""
    owner = user
    acc = (
        db.query(FinancialAccount)
        .filter(FinancialAccount.id == account_id, FinancialAccount.user_id == owner.id)
        .first()
    )
    if acc is None:
        raise HTTPException(status_code=404, detail="Account not found")

    if req.account_name is not None:
        acc.account_name = req.account_name
    if req.account_type is not None:
        acc.account_type = req.account_type
    if req.balance is not None:
        acc.balance = req.balance
    if req.currency is not None:
        acc.currency = req.currency
    if req.is_liquid is not None:
        acc.is_liquid = req.is_liquid
    if req.institution_name is not None:
        acc.institution_name = req.institution_name
    if req.notes is not None:
        acc.notes = req.notes

    db.commit()
    db.refresh(acc)
    return _to_account_response(acc)


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    """Delete a financial account."""
    owner = user
    acc = (
        db.query(FinancialAccount)
        .filter(FinancialAccount.id == account_id, FinancialAccount.user_id == owner.id)
        .first()
    )
    if acc is None:
        raise HTTPException(status_code=404, detail="Account not found")
    db.delete(acc)
    db.commit()


# =========================================================================
# Transactions & CSV Import
# =========================================================================


@router.post(
    "/transactions", response_model=TransactionResponse, status_code=status.HTTP_201_CREATED
)
def create_transaction(
    req: TransactionCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TransactionResponse:
    """Create an individual income/expense transaction."""
    owner = user
    account = None
    if req.account_id:
        account = (
            db.query(FinancialAccount)
            .filter(FinancialAccount.id == req.account_id, FinancialAccount.user_id == owner.id)
            .first()
        )
        if account is None:
            # The same answer for an account that does not exist and one that is someone else's.
            raise ApiError(404, "not_found", "No such account.")

    tx = FinancialTransaction(
        id=str(uuid.uuid4()),
        user_id=owner.id,
        account_id=account.id if account else None,
        transaction_date=req.transaction_date,
        amount=req.amount,
        transaction_type=req.transaction_type,
        category=req.category,
        description=req.description,
        is_essential=req.is_essential,
    )
    db.add(tx)

    if account is not None:
        if req.transaction_type == "credit":
            account.balance += req.amount
        else:
            account.balance -= req.amount

    db.commit()
    db.refresh(tx)
    return _to_tx_response(tx)


@router.get("/transactions", response_model=list[TransactionResponse])
def list_transactions(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[TransactionResponse]:
    """List transactions for the current user."""
    owner = user
    txs = (
        db.query(FinancialTransaction)
        .filter(FinancialTransaction.user_id == owner.id)
        .order_by(FinancialTransaction.transaction_date.desc())
        .all()
    )
    return [_to_tx_response(t) for t in txs]


@router.delete("/transactions/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(
    transaction_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    """Delete a transaction and reverse its effect on account balance if applicable."""
    owner = user
    tx = (
        db.query(FinancialTransaction)
        .filter(FinancialTransaction.id == transaction_id, FinancialTransaction.user_id == owner.id)
        .first()
    )
    if tx is None:
        raise HTTPException(status_code=404, detail="Transaction not found")

    if tx.account_id:
        account = (
            db.query(FinancialAccount)
            .filter(FinancialAccount.id == tx.account_id, FinancialAccount.user_id == owner.id)
            .first()
        )
        if account:
            if tx.transaction_type == "credit":
                account.balance -= tx.amount
            else:
                account.balance += tx.amount

    db.delete(tx)
    db.commit()


@router.post("/transfers", response_model=TransferResponse, status_code=status.HTTP_201_CREATED)
def create_transfer(
    req: TransferCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TransferResponse:
    """Transfer funds between two accounts without double-counting as income or expenditure."""
    owner = user
    if req.from_account_id == req.to_account_id:
        raise ApiError(400, "invalid_transfer", "Source and destination accounts must be different.")

    from_acc = (
        db.query(FinancialAccount)
        .filter(FinancialAccount.id == req.from_account_id, FinancialAccount.user_id == owner.id)
        .first()
    )
    to_acc = (
        db.query(FinancialAccount)
        .filter(FinancialAccount.id == req.to_account_id, FinancialAccount.user_id == owner.id)
        .first()
    )
    if not from_acc or not to_acc:
        raise ApiError(404, "not_found", "One or both accounts not found.")

    desc = req.description or f"Transfer from {from_acc.account_name} to {to_acc.account_name}"

    out_tx = FinancialTransaction(
        id=str(uuid.uuid4()),
        user_id=owner.id,
        account_id=from_acc.id,
        transaction_date=req.transaction_date,
        amount=req.amount,
        transaction_type="debit",
        category="Transfer",
        description=f"{desc} (Outflow)",
        is_essential=False,
    )
    in_tx = FinancialTransaction(
        id=str(uuid.uuid4()),
        user_id=owner.id,
        account_id=to_acc.id,
        transaction_date=req.transaction_date,
        amount=req.amount,
        transaction_type="credit",
        category="Transfer",
        description=f"{desc} (Inflow)",
        is_essential=False,
    )

    from_acc.balance -= req.amount
    to_acc.balance += req.amount

    db.add(out_tx)
    db.add(in_tx)
    db.commit()
    db.refresh(out_tx)
    db.refresh(in_tx)

    return TransferResponse(
        from_transaction=_to_tx_response(out_tx),
        to_transaction=_to_tx_response(in_tx),
    )


MAX_IMPORT_BYTES = 1_000_000
MAX_IMPORT_ROWS = 5_000
MAX_ERRORS_REPORTED = 50
_TRUE_VALUES = {"true", "1", "yes"}
_FALSE_VALUES = {"false", "0", "no", ""}


def _parse_import_row(row: dict[str, str]) -> tuple[FinancialTransaction | None, str | None]:
    """Validate one CSV row. Returns the transaction, or a message saying what is wrong."""
    date_text = (row.get("date") or row.get("transaction_date") or "").strip()
    try:
        transaction_date = date.fromisoformat(date_text).isoformat()
    except ValueError:
        return None, "date must be a real date written YYYY-MM-DD"

    amount_text = (row.get("amount") or "").replace(",", "").strip()
    try:
        amount = Decimal(amount_text)
    except InvalidOperation:
        return None, "amount is not a number"
    if not amount.is_finite():
        return None, "amount must be a finite number"
    if amount <= 0:
        return None, "amount must be greater than zero (use type credit or debit for direction)"
    if amount > MAX_MONEY:
        return None, "amount is larger than the supported maximum"
    if amount.as_tuple().exponent < -2:
        return None, "amount can have at most 2 decimal places"

    kind = (row.get("type") or "").strip().lower()
    if kind not in ("credit", "debit"):
        return None, "type must be credit or debit"

    essential_text = (row.get("is_essential") or row.get("essential") or "").strip().lower()
    if essential_text not in _TRUE_VALUES | _FALSE_VALUES:
        return None, "is_essential must be true or false"

    category = (row.get("category") or "General").strip()[:120] or "General"
    description = (row.get("description") or "").strip()[:1000]
    return (
        FinancialTransaction(
            id=str(uuid.uuid4()),
            transaction_date=transaction_date,
            amount=amount,
            transaction_type=kind,
            category=category,
            description=description,
            is_essential=essential_text in _TRUE_VALUES,
        ),
        None,
    )


@router.post("/transactions/import", response_model=CSVImportResponse)
async def import_transactions_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CSVImportResponse:
    """Import transactions from a CSV file. Rows that fail validation or repeat an existing
    transaction are skipped and reported; nothing invalid is stored or silently corrected."""
    content = await file.read(MAX_IMPORT_BYTES + 1)
    if len(content) > MAX_IMPORT_BYTES:
        raise ApiError(
            413, "file_too_large", f"The file must be under {MAX_IMPORT_BYTES // 1000} KB."
        )
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ApiError(422, "invalid_encoding", "The file must be UTF-8 text.") from error

    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise ApiError(422, "invalid_csv", "The file has no header row.")
    reader.fieldnames = [name.strip().lower() for name in reader.fieldnames]
    if "amount" not in reader.fieldnames or not {"date", "transaction_date"} & set(
        reader.fieldnames
    ):
        raise ApiError(422, "invalid_csv", "The header row must include date and amount columns.")

    rows = list(itertools.islice(reader, MAX_IMPORT_ROWS + 1))
    if len(rows) > MAX_IMPORT_ROWS:
        raise ApiError(422, "too_many_rows", f"The file can have at most {MAX_IMPORT_ROWS} rows.")

    def signature(t: FinancialTransaction) -> tuple:
        return (t.transaction_date, t.amount, t.transaction_type, t.category, t.description)

    seen = {
        (r.transaction_date, r.amount, r.transaction_type, r.category, r.description or "")
        for r in db.query(
            FinancialTransaction.transaction_date,
            FinancialTransaction.amount,
            FinancialTransaction.transaction_type,
            FinancialTransaction.category,
            FinancialTransaction.description,
        ).filter(FinancialTransaction.user_id == user.id)
    }

    imported = failed = duplicates = 0
    errors: list[str] = []
    for line_number, row in enumerate(rows, start=2):
        transaction, problem = _parse_import_row({k: v for k, v in row.items() if k})
        if transaction is None:
            failed += 1
            errors.append(f"Row {line_number}: {problem}")
            continue
        key = signature(transaction)
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        transaction.user_id = user.id
        db.add(transaction)
        imported += 1

    db.commit()
    return CSVImportResponse(
        imported_count=imported,
        failed_count=failed,
        duplicate_count=duplicates,
        errors=errors[:MAX_ERRORS_REPORTED],
        errors_truncated=len(errors) > MAX_ERRORS_REPORTED,
    )


# =========================================================================
# Assets & Investments
# =========================================================================


@router.post("/investments", response_model=InvestmentResponse, status_code=status.HTTP_201_CREATED)
def create_investment(
    req: InvestmentCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InvestmentResponse:
    """Record an asset or investment (stocks, mutual funds, gold, EPF, etc.)."""
    owner = user
    inv = AssetInvestment(
        id=str(uuid.uuid4()),
        user_id=owner.id,
        asset_name=req.asset_name,
        asset_type=req.asset_type,
        symbol=req.symbol,
        quantity=Decimal(str(req.quantity)),
        purchase_price=req.purchase_price,
        current_value=req.current_value,
        is_liquid=req.is_liquid,
        last_valuation_date=req.last_valuation_date,
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return _to_inv_response(inv)


@router.get("/investments", response_model=list[InvestmentResponse])
def list_investments(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[InvestmentResponse]:
    """List all assets and investments for the user."""
    owner = user
    items = (
        db.query(AssetInvestment)
        .filter(AssetInvestment.user_id == owner.id)
        .order_by(AssetInvestment.created_at.desc())
        .all()
    )
    return [_to_inv_response(i) for i in items]


@router.get("/investments/{investment_id}", response_model=InvestmentResponse)
def get_investment(
    investment_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InvestmentResponse:
    """Get an investment by ID."""
    owner = user
    inv = (
        db.query(AssetInvestment)
        .filter(AssetInvestment.id == investment_id, AssetInvestment.user_id == owner.id)
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Investment not found")
    return _to_inv_response(inv)


@router.put("/investments/{investment_id}", response_model=InvestmentResponse)
def update_investment(
    investment_id: str,
    req: InvestmentUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InvestmentResponse:
    """Update an investment."""
    owner = user
    inv = (
        db.query(AssetInvestment)
        .filter(AssetInvestment.id == investment_id, AssetInvestment.user_id == owner.id)
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Investment not found")

    if req.asset_name is not None:
        inv.asset_name = req.asset_name
    if req.asset_type is not None:
        inv.asset_type = req.asset_type
    if req.symbol is not None:
        inv.symbol = req.symbol
    if req.quantity is not None:
        inv.quantity = Decimal(str(req.quantity))
    if req.purchase_price is not None:
        inv.purchase_price = req.purchase_price
    if req.current_value is not None:
        inv.current_value = req.current_value
    if req.is_liquid is not None:
        inv.is_liquid = req.is_liquid
    if req.last_valuation_date is not None:
        inv.last_valuation_date = req.last_valuation_date

    db.commit()
    db.refresh(inv)
    return _to_inv_response(inv)


@router.delete("/investments/{investment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_investment(
    investment_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    """Delete an investment."""
    owner = user
    inv = (
        db.query(AssetInvestment)
        .filter(AssetInvestment.id == investment_id, AssetInvestment.user_id == owner.id)
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Investment not found")
    db.delete(inv)
    db.commit()


@router.post("/investments/sip-calculator", response_model=SipProjectionResponse)
def calculate_sip(req: SipProjectionRequest) -> SipProjectionResponse:
    """Calculate SIP wealth growth trajectory with optional periodic step-ups."""
    res = calculate_sip_projection(
        monthly_investment=req.monthly_investment,
        annual_expected_return=req.annual_expected_return,
        tenure_years=req.tenure_years,
        initial_investment=req.initial_investment,
        step_up_percentage=req.step_up_percentage,
        step_up_amount=req.step_up_amount,
        step_up_frequency_months=req.step_up_frequency_months,
    )
    return SipProjectionResponse.model_validate(res)


# =========================================================================
# Liabilities
# =========================================================================


@router.post("/liabilities", response_model=LiabilityResponse, status_code=status.HTTP_201_CREATED)
def create_liability(
    req: LiabilityCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> LiabilityResponse:
    """Record a loan, mortgage or credit liability."""
    owner = user
    liab = Liability(
        id=str(uuid.uuid4()),
        user_id=owner.id,
        liability_name=req.liability_name,
        liability_type=req.liability_type,
        principal_amount=req.principal_amount,
        current_balance=req.current_balance,
        interest_rate=req.interest_rate,
        monthly_emi=req.monthly_emi,
        remaining_months=req.remaining_months,
        start_date=req.start_date,
        end_date=req.end_date,
    )
    db.add(liab)
    db.commit()
    db.refresh(liab)
    return _to_liab_response(liab)


@router.get("/liabilities", response_model=list[LiabilityResponse])
def list_liabilities(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[LiabilityResponse]:
    """List all liabilities for the user."""
    owner = user
    items = (
        db.query(Liability)
        .filter(Liability.user_id == owner.id)
        .order_by(Liability.created_at.desc())
        .all()
    )
    return [_to_liab_response(liab) for liab in items]


@router.get("/liabilities/{liability_id}", response_model=LiabilityResponse)
def get_liability(
    liability_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> LiabilityResponse:
    """Get a liability by ID."""
    owner = user
    liab = (
        db.query(Liability)
        .filter(Liability.id == liability_id, Liability.user_id == owner.id)
        .first()
    )
    if not liab:
        raise HTTPException(status_code=404, detail="Liability not found")
    return _to_liab_response(liab)


@router.put("/liabilities/{liability_id}", response_model=LiabilityResponse)
def update_liability(
    liability_id: str,
    req: LiabilityUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> LiabilityResponse:
    """Update a liability."""
    owner = user
    liab = (
        db.query(Liability)
        .filter(Liability.id == liability_id, Liability.user_id == owner.id)
        .first()
    )
    if not liab:
        raise HTTPException(status_code=404, detail="Liability not found")

    if req.liability_name is not None:
        liab.liability_name = req.liability_name
    if req.liability_type is not None:
        liab.liability_type = req.liability_type
    if req.principal_amount is not None:
        liab.principal_amount = req.principal_amount
    if req.current_balance is not None:
        liab.current_balance = req.current_balance
    if req.interest_rate is not None:
        liab.interest_rate = req.interest_rate
    if req.monthly_emi is not None:
        liab.monthly_emi = req.monthly_emi
    if req.remaining_months is not None:
        liab.remaining_months = req.remaining_months
    if req.start_date is not None:
        liab.start_date = req.start_date
    if req.end_date is not None:
        liab.end_date = req.end_date

    db.commit()
    db.refresh(liab)
    return _to_liab_response(liab)


@router.delete("/liabilities/{liability_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_liability(
    liability_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    """Delete a liability."""
    owner = user
    liab = (
        db.query(Liability)
        .filter(Liability.id == liability_id, Liability.user_id == owner.id)
        .first()
    )
    if not liab:
        raise HTTPException(status_code=404, detail="Liability not found")
    db.delete(liab)
    db.commit()


# =========================================================================
# Net Worth
# =========================================================================


@router.get("/net-worth", response_model=NetWorthResponse)
def get_net_worth(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> NetWorthResponse:
    """Calculate comprehensive personal net worth with liquid and illiquid breakdowns."""
    owner = user
    accounts = db.query(FinancialAccount).filter(FinancialAccount.user_id == owner.id).all()
    investments = db.query(AssetInvestment).filter(AssetInvestment.user_id == owner.id).all()
    liabilities = db.query(Liability).filter(Liability.user_id == owner.id).all()

    liquid_accounts = sum((a.balance for a in accounts if a.is_liquid), Decimal("0.00"))
    illiquid_accounts = sum((a.balance for a in accounts if not a.is_liquid), Decimal("0.00"))

    liquid_investments = sum((i.current_value for i in investments if i.is_liquid), Decimal("0.00"))
    illiquid_investments = sum(
        (i.current_value for i in investments if not i.is_liquid), Decimal("0.00")
    )

    total_liquid = liquid_accounts + liquid_investments
    total_illiquid = illiquid_accounts + illiquid_investments
    total_assets = total_liquid + total_illiquid
    total_liabilities = sum((liab.current_balance for liab in liabilities), Decimal("0.00"))
    net_worth = total_assets - total_liabilities

    return NetWorthResponse(
        total_assets=total_assets,
        liquid_assets=total_liquid,
        illiquid_assets=total_illiquid,
        total_liabilities=total_liabilities,
        net_worth=net_worth,
    )


# =========================================================================
# Helpers
# =========================================================================


def _to_account_response(a: FinancialAccount) -> AccountResponse:
    return AccountResponse(
        id=a.id,
        account_name=a.account_name,
        account_type=a.account_type,
        balance=a.balance,
        currency=a.currency,
        is_liquid=a.is_liquid,
        institution_name=a.institution_name,
        notes=a.notes,
        created_at=a.created_at.isoformat(),
    )


def _to_tx_response(t: FinancialTransaction) -> TransactionResponse:
    return TransactionResponse(
        id=t.id,
        account_id=t.account_id,
        transaction_date=t.transaction_date,
        amount=t.amount,
        transaction_type=t.transaction_type,
        category=t.category,
        description=t.description,
        is_essential=t.is_essential,
        created_at=t.created_at.isoformat(),
    )


def _to_inv_response(i: AssetInvestment) -> InvestmentResponse:
    return InvestmentResponse(
        id=i.id,
        asset_name=i.asset_name,
        asset_type=i.asset_type,
        symbol=i.symbol,
        quantity=i.quantity,
        purchase_price=i.purchase_price,
        current_value=i.current_value,
        is_liquid=i.is_liquid,
        last_valuation_date=i.last_valuation_date,
        created_at=i.created_at.isoformat(),
    )


def _to_liab_response(liab: Liability) -> LiabilityResponse:
    return LiabilityResponse(
        id=liab.id,
        liability_name=liab.liability_name,
        liability_type=liab.liability_type,
        principal_amount=liab.principal_amount,
        current_balance=liab.current_balance,
        interest_rate=liab.interest_rate,
        monthly_emi=liab.monthly_emi,
        remaining_months=liab.remaining_months,
        created_at=liab.created_at.isoformat(),
    )
