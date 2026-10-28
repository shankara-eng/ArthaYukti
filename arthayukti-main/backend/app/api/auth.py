import hashlib
import logging
import secrets
import sqlite3
import uuid
from contextlib import closing
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import mail, ratelimit
from app.api.common import AUTH_RESPONSES
from app.api.deps import get_current_user, get_db
from app.api.financials import (
    _to_account_response,
    _to_inv_response,
    _to_liab_response,
    _to_tx_response,
)
from app.api.household import _to_profile_response
from app.api.insurance import _to_policy_response
from app.api.spending import _plan_out, _settings_out, list_categories
from app.config import BACKEND_DIR, settings
from app.db.models import (
    AssetInvestment,
    AuditLog,
    CalculatorScenario,
    ExpenditurePlan,
    FinancialAccount,
    FinancialTransaction,
    HouseholdProfile,
    InsurancePolicy,
    InvestmentTransaction,
    Liability,
    PasswordReset,
    RecoveryAgreement,
    SavedPlan,
    User,
)
from app.schemas.auth import (
    AuthResponse,
    ExportAccount,
    ExportCalculatorScenario,
    ExportExpenditure,
    ExportInvestmentTransaction,
    ExportPlan,
    ExportPolicy,
    ExportRecoveryAgreement,
    ExportResponse,
    ExportUser,
    LoginRequest,
    MessageResponse,
    PasswordResetConfirm,
    PasswordResetRequest,
    Preferences,
    PreferencesUpdate,
    SignupRequest,
    UserProfile,
)
from app.schemas.calculators import CalculatorConfig
from app.schemas.plan import Plan
from app.schemas.recovery_plan import AgreementDraft
from app.security import (
    create_access_token,
    hash_password,
    verify_password,
)

logger = logging.getLogger("arthayukti")

router = APIRouter(prefix="/auth", tags=["auth"], responses=AUTH_RESPONSES)

LOGIN_WINDOW = 15 * 60
SIGNUP_WINDOW = 60 * 60
RESET_WINDOW = 60 * 60


@lru_cache(maxsize=1)
def _dummy_hash() -> str:
    """A real bcrypt hash checked when the e-mail is unknown, so timing does not reveal it."""
    return hash_password(secrets.token_urlsafe(16))


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _as_utc(value: datetime) -> datetime:
    """SQLite returns naive datetimes. Everything stored here is UTC, so label it as such."""
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _profile(user: User) -> UserProfile:
    return UserProfile(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_active=user.is_active,
        created_at=user.created_at.isoformat(),
    )


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def signup(req: SignupRequest, request: Request, db: Session = Depends(get_db)) -> AuthResponse:
    """Register a new user account with secure password hashing."""
    ratelimit.enforce(request, "signup", 10, SIGNUP_WINDOW)
    normalized_email = req.email.strip().lower()
    if db.query(User).filter(func.lower(User.email) == normalized_email).first():
        # Deliberately vague. Fully hiding whether an address is registered needs e-mail
        # verification, which does not exist yet.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="We could not create an account with these details.",
        )

    user = User(
        id=str(uuid.uuid4()),
        email=normalized_email,
        hashed_password=hash_password(req.password),
        full_name=req.full_name.strip(),
        is_active=True,
        is_verified=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    db.add(
        AuditLog(user_id=user.id, action="USER_SIGNUP", resource_type="USER", resource_id=user.id)
    )
    db.commit()

    return AuthResponse(access_token=create_access_token(user.id, user.email), user=_profile(user))


def _legacy_db_path() -> Path:
    return BACKEND_DIR / "arthayukti_dev.db"


def _fallback_dev_db_user(email: str, password: str, db: Session) -> User | None:
    """Local development only: sign in with an account that lives in `arthayukti_dev.db`, the file an older run of
    the app used (two dev databases ended up side by side).

    The password must match the one stored there. The legacy file is opened read-only and never changed. The account
    is copied into the current database (or, if the same e-mail already exists, takes the legacy password), so the
    next sign-in works normally. It does nothing outside development: where real accounts live, a password stored
    in some other file must never be able to replace the current one."""
    if settings.ENVIRONMENT != "development":
        return None
    path = _legacy_db_path()
    if not path.is_file():
        return None
    try:
        with closing(sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)) as conn:
            row = conn.execute(
                "SELECT id, email, hashed_password, full_name, is_active FROM users WHERE lower(email) = ?",
                (email.lower(),),
            ).fetchone()
        if not row:
            return None
        dev_id, _dev_email, dev_hash, dev_name, dev_active = row
        if not verify_password(password, dev_hash):
            return None

        existing = db.query(User).filter(func.lower(User.email) == email.lower()).first()
        if existing:
            existing.hashed_password = dev_hash
            db.commit()
            db.refresh(existing)
            return existing
        new_user = User(
            id=dev_id,
            email=email.lower().strip(),
            hashed_password=dev_hash,
            full_name=dev_name or "",
            is_active=bool(dev_active),
            is_verified=False,
        )
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
        return new_user
    except Exception as error:
        db.rollback()  # a failed copy must not leave the session unusable
        logger.warning("Error checking legacy dev db: %s", type(error).__name__)
        return None


@router.post("/login", response_model=AuthResponse)
def login(req: LoginRequest, request: Request, db: Session = Depends(get_db)) -> AuthResponse:
    """Authenticate with email and password and receive a signed JWT."""
    normalized_email = req.email.strip().lower()
    ratelimit.enforce(request, "login-address", 60, LOGIN_WINDOW)
    ratelimit.enforce(request, "login", 10, LOGIN_WINDOW, normalized_email)
    user = db.query(User).filter(func.lower(User.email) == normalized_email).first()
    password_ok = verify_password(req.password, user.hashed_password if user else _dummy_hash())
    if not password_ok:
        legacy_user = _fallback_dev_db_user(normalized_email, req.password, db)
        if legacy_user:
            user = legacy_user
            password_ok = True

    if not user or not password_ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled.")

    db.add(
        AuditLog(user_id=user.id, action="USER_LOGIN", resource_type="USER", resource_id=user.id)
    )
    db.commit()

    return AuthResponse(access_token=create_access_token(user.id, user.email), user=_profile(user))


@router.post("/logout", response_model=MessageResponse)
def logout(current_user: User = Depends(get_current_user)) -> MessageResponse:
    """End the session on the client. Tokens are stateless, so they expire on their own."""
    return MessageResponse(message="Successfully logged out.")


@router.get("/me", response_model=UserProfile)
def get_current_user_profile(current_user: User = Depends(get_current_user)) -> UserProfile:
    """Fetch profile of current authenticated user."""
    return _profile(current_user)


def _preferences(user: User) -> Preferences:
    """The stored default, or the application's starting value (shown as such) until the person sets one."""
    stored = user.default_inflation_annual
    value = Decimal(str(stored)) if stored is not None else Decimal(settings.DEFAULT_GOAL_INFLATION)
    return Preferences(
        default_inflation_annual=value.quantize(Decimal("0.000001")), is_default=stored is None
    )


@router.get("/preferences", response_model=Preferences)
def get_preferences(current_user: User = Depends(get_current_user)) -> Preferences:
    """The signed-in person's settings: today the default annual inflation assumption."""
    return _preferences(current_user)


@router.put("/preferences", response_model=Preferences)
def update_preferences(
    req: PreferencesUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Preferences:
    """Save the default inflation. It is the starting value for new plans and calculations only: saved
    calculations, plans and Recovery Agreements keep the figure they were saved with."""
    current_user.default_inflation_annual = req.default_inflation_annual
    db.commit()
    db.refresh(current_user)
    return _preferences(current_user)


@router.post("/password-reset/request", response_model=MessageResponse)
def request_password_reset(
    req: PasswordResetRequest, request: Request, db: Session = Depends(get_db)
) -> MessageResponse:
    """E-mail a single-use reset link. Unavailable until a mail transport is configured."""
    if not mail.mail_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Password reset by e-mail is not available yet.",
        )
    normalized_email = req.email.strip().lower()
    ratelimit.enforce(request, "reset-request-address", 20, RESET_WINDOW)
    ratelimit.enforce(request, "reset-request", 5, RESET_WINDOW, normalized_email)
    user = (
        db.query(User)
        .filter(func.lower(User.email) == normalized_email, User.is_active.is_(True))
        .first()
    )
    if user:
        token = secrets.token_urlsafe(32)
        db.add(
            PasswordReset(
                user_id=user.id,
                token_hash=_hash_token(token),
                expires_at=datetime.now(UTC)
                + timedelta(minutes=settings.PASSWORD_RESET_TTL_MINUTES),
                used=False,
            )
        )
        db.commit()
        try:
            mail.send_password_reset(user.email, token)
        except Exception as error:
            # Same answer as for an unknown address, so an outage does not reveal who is
            # registered. The token was never delivered, so it is retired at once. Only the
            # error type is logged: never the token or the address.
            logger.warning("Password reset e-mail not sent (%s).", type(error).__name__)
            for pending in (
                db.query(PasswordReset)
                .filter(PasswordReset.user_id == user.id, PasswordReset.used.is_(False))
                .all()
            ):
                pending.used = True
            db.commit()
    # The same answer whether or not the address is registered.
    return MessageResponse(
        message="If that address is registered, a reset link has been sent to it."
    )


@router.post("/password-reset/confirm", response_model=MessageResponse)
def confirm_password_reset(
    req: PasswordResetConfirm, request: Request, db: Session = Depends(get_db)
) -> MessageResponse:
    """Set a new password with a valid, unused, unexpired reset token."""
    ratelimit.enforce(request, "reset-confirm", 20, RESET_WINDOW)
    reset = (
        db.query(PasswordReset)
        .filter(PasswordReset.token_hash == _hash_token(req.token), PasswordReset.used.is_(False))
        .first()
    )
    invalid = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Reset token is invalid or has expired.",
    )
    if reset is None or _as_utc(reset.expires_at) < datetime.now(UTC):
        raise invalid

    user = db.query(User).filter(User.id == reset.user_id, User.is_active.is_(True)).first()
    if user is None:
        raise invalid

    user.hashed_password = hash_password(req.new_password)
    # One use only, and any other outstanding link for this account stops working too.
    for other in (
        db.query(PasswordReset)
        .filter(PasswordReset.user_id == user.id, PasswordReset.used.is_(False))
        .all()
    ):
        other.used = True
    db.add(
        AuditLog(
            user_id=user.id, action="PASSWORD_RESET", resource_type="USER", resource_id=user.id
        )
    )
    db.commit()

    return MessageResponse(message="Password has been reset successfully.")


@router.get("/export-data", response_model=ExportResponse)
def export_user_data(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ExportResponse:
    """Export of the personal data held for the signed-in user."""
    uid = current_user.id
    plans = db.query(SavedPlan).filter(SavedPlan.user_id == uid).all()
    accounts = db.query(FinancialAccount).filter(FinancialAccount.user_id == uid).all()
    policies = db.query(InsurancePolicy).filter(InsurancePolicy.user_id == uid).all()
    investments = db.query(AssetInvestment).filter(AssetInvestment.user_id == uid).all()
    liabilities = db.query(Liability).filter(Liability.user_id == uid).all()
    transactions = (
        db.query(FinancialTransaction)
        .filter(FinancialTransaction.user_id == uid)
        .order_by(FinancialTransaction.transaction_date, FinancialTransaction.id)
        .all()
    )
    household = db.query(HouseholdProfile).filter(HouseholdProfile.user_id == uid).first()
    scenarios = (
        db.query(CalculatorScenario)
        .filter(CalculatorScenario.user_id == uid)
        .order_by(CalculatorScenario.name)
        .all()
    )
    agreements = (
        db.query(RecoveryAgreement)
        .filter(RecoveryAgreement.user_id == uid)
        .order_by(RecoveryAgreement.name)
        .all()
    )
    ledger_rows = db.query(InvestmentTransaction).filter(InvestmentTransaction.user_id == uid).all()
    return ExportResponse(
        user=ExportUser(
            id=current_user.id,
            email=current_user.email,
            full_name=current_user.full_name,
            created_at=current_user.created_at.isoformat(),
            default_inflation_annual=(
                str(current_user.default_inflation_annual)
                if current_user.default_inflation_annual is not None
                else None
            ),
        ),
        plans=[
            ExportPlan(id=p.id, name=p.name, as_of=p.as_of, plan=Plan.model_validate_json(p.plan_json))
            for p in plans
        ],
        accounts=[
            ExportAccount(
                id=a.id,
                name=a.account_name,
                type=a.account_type,
                balance=str(a.balance),
                details=_to_account_response(a),
            )
            for a in accounts
        ],
        policies=[
            ExportPolicy(id=p.id, number=p.policy_number, type=p.policy_type, details=_to_policy_response(p))
            for p in policies
        ],
        investments=[_to_inv_response(i) for i in investments],
        liabilities=[_to_liab_response(liab) for liab in liabilities],
        transactions=[_to_tx_response(t) for t in transactions],
        household_profile=_to_profile_response(household),
        investment_transactions=[
            ExportInvestmentTransaction(
                id=x.id,
                holding_id=x.holding_id,
                transaction_type=x.transaction_type,
                trade_date=x.trade_date,
                quantity=None if x.quantity is None else str(x.quantity),
                price=None if x.price is None else str(x.price),
                fees=str(x.fees),
                ratio_new=x.ratio_new,
                ratio_old=x.ratio_old,
                notes=x.notes,
            )
            for x in ledger_rows
        ],
        recovery_agreements=[
            ExportRecoveryAgreement(
                id=r.id,
                name=r.name,
                version=r.versions[-1].version,
                draft=AgreementDraft.model_validate_json(r.versions[-1].draft_json),
            )
            for r in agreements
        ],
        expenditure=ExportExpenditure(
            plans=[
                _plan_out(db, current_user, p)
                for p in db.query(ExpenditurePlan).filter(ExpenditurePlan.user_id == uid).order_by(ExpenditurePlan.created_at).all()
            ],
            categories=list_categories(db, current_user),
            settings=_settings_out(db, current_user),
        ),
        calculator_scenarios=[
            ExportCalculatorScenario(
                id=c.id, name=c.name, config=CalculatorConfig.model_validate_json(c.config_json)
            )
            for c in scenarios
        ],
    )


@router.delete("/delete-account", response_model=MessageResponse)
def delete_account(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> MessageResponse:
    """Completely wipe user account and all associated tenant data."""
    db.delete(current_user)
    db.commit()
    return MessageResponse(message="Account and all personal records permanently deleted.")
