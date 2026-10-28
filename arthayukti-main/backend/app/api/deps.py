from fastapi import Depends, HTTPException, Request, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.db.models import User
from app.db.session import get_db
from app.security import decode_access_token

# Declares the bearer scheme in the OpenAPI document. auto_error is off so that a missing,
# malformed or expired token is answered with the shared error shape below.
bearer_scheme = HTTPBearer(
    auto_error=False, description="Access token from /auth/login or /auth/signup"
)


# Public routes that also accept a token (to record who ran a calculation). The OpenAPI document
# must say the token is optional for these, not required.
OPTIONAL_AUTH_PATHS = {"/api/v1/rescue/analyze"}


def _unauthorized(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=message,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _user_for(
    request: Request, credentials: HTTPAuthorizationCredentials | None, db: Session
) -> User:
    if credentials is None:
        # A header that is not "Bearer <token>" is malformed, not absent.
        if request.headers.get("authorization"):
            raise _unauthorized("Malformed authentication header")
        raise _unauthorized("Authentication required")
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise _unauthorized("Token has expired or is invalid")
    user = db.query(User).filter(User.id == payload.sub, User.is_active.is_(True)).first()
    if user is None:
        raise _unauthorized("User not found or inactive")
    return user


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """The signed-in user, or 401. Use this on every route that touches a person's records."""
    return _user_for(request, credentials, db)


def get_optional_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
    db: Session = Depends(get_db),
) -> User | None:
    """For public calculation routes: no header means anonymous, but a bad token is still 401.

    An anonymous caller never reaches stored records; they only get calculations.
    """
    if credentials is None and not request.headers.get("authorization"):
        return None
    return _user_for(request, credentials, db)
