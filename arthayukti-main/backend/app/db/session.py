from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from app.config import settings

# For SQLite, check_same_thread=False is required for FastAPI multithreaded requests
connect_args = {"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {}

# A hosted PostgreSQL (Neon) closes idle connections and suspends its compute. pool_pre_ping tests a pooled
# connection before use and replaces a dead one, pool_recycle retires old ones, and the connect timeout makes
# a database that is waking up (or unreachable) fail in seconds instead of hanging a request.
pool_args: dict[str, object] = (
    {}
    if settings.DATABASE_URL.startswith("sqlite")
    else {"pool_pre_ping": True, "pool_recycle": 300, "pool_size": 5, "max_overflow": 5}
)
if not settings.DATABASE_URL.startswith("sqlite"):
    connect_args = {"connect_timeout": 15}

def _engine_url() -> str:
    url = settings.DATABASE_URL
    if url in ("sqlite:///./arthayukti.db", "sqlite:///arthayukti.db"):
        from app.config import BACKEND_DIR
        return f"sqlite:///{(BACKEND_DIR / 'arthayukti.db').resolve().as_posix()}"
    return url


engine = create_engine(
    _engine_url(),
    connect_args=connect_args,
    echo=False,
    **pool_args,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency that yields a database session and safely closes it."""
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
