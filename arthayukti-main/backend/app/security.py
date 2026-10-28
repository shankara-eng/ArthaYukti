from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
import jwt
from pydantic import BaseModel

from app.config import settings


class TokenPayload(BaseModel):
    sub: str  # User ID
    email: str
    exp: int


def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    salt = bcrypt.gensalt(rounds=12)
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its bcrypt hash."""
    if not plain_password or not hashed_password:
        return False
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str, expires_delta: timedelta | None = None) -> str:
    """Generate a signed JWT access token."""
    expire = datetime.now(UTC) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode = {
        "sub": str(user_id),
        "email": email,
        "exp": int(expire.timestamp()),
        "iat": int(datetime.now(UTC).timestamp()),
    }
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def decode_access_token(token: str) -> TokenPayload | None:
    """Decode and validate a JWT access token."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return TokenPayload(**payload)
    except (jwt.PyJWTError, ValueError):
        return None


def mask_sensitive_data(data: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of data with passwords, tokens, and sensitive financial identifiers masked."""
    masked = {}
    sensitive_keys = {
        "password",
        "hashed_password",
        "token",
        "secret",
        "access_token",
        "policy_number",
        "account_number",
        "pan",
        "aadhaar",
        "medical_notes",
    }
    for k, v in data.items():
        if k.lower() in sensitive_keys:
            masked[k] = "[REDACTED]"
        elif isinstance(v, dict):
            masked[k] = mask_sensitive_data(v)
        elif isinstance(v, list):
            masked[k] = [mask_sensitive_data(i) if isinstance(i, dict) else i for i in v]
        else:
            masked[k] = v
    return masked
