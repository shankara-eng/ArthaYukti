"""Optional development helpers. The schema itself is created only by Alembic migrations:

cd backend && alembic upgrade head
"""

import logging

from sqlalchemy.orm import Session

from app.config import settings
from app.db.models import User
from app.db.session import SessionLocal
from app.security import hash_password

logger = logging.getLogger("arthayukti")

DEMO_EMAIL = "demo@arthayukti.in"
MIN_DEMO_PASSWORD_LENGTH = 12


def demo_seed_enabled() -> bool:
    return (
        settings.ENVIRONMENT == "development"
        and settings.SEED_DEMO_USER
        and len(settings.DEMO_USER_PASSWORD) >= MIN_DEMO_PASSWORD_LENGTH
    )


def seed_demo_user_if_enabled() -> bool:
    """Create the demo account only in development, only when SEED_DEMO_USER is on, and only
    with a password taken from DEMO_USER_PASSWORD. Returns whether a user was created."""
    if not demo_seed_enabled():
        return False
    db: Session = SessionLocal()
    try:
        if db.query(User).filter(User.email == DEMO_EMAIL).first():
            return False
        db.add(
            User(
                email=DEMO_EMAIL,
                hashed_password=hash_password(settings.DEMO_USER_PASSWORD),
                full_name="Demo Household",
                is_active=True,
                is_verified=True,
            )
        )
        db.commit()
        logger.info("Seeded the development demo user.")
        return True
    except Exception:
        db.rollback()
        logger.warning("Demo user seed skipped.")
        return False
    finally:
        db.close()


if __name__ == "__main__":
    created = seed_demo_user_if_enabled()
    print("Demo user created." if created else "Nothing seeded (disabled, or it already exists).")
