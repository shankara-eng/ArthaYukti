import logging
from functools import lru_cache
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.db.session import engine
from app.schemas.types import ApiModel

router = APIRouter(tags=["health"])
logger = logging.getLogger("arthayukti")

BACKEND = Path(__file__).resolve().parents[2]


class HealthResponse(ApiModel):
    status: str


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Liveness: the process is up. It does not touch the database."""
    return HealthResponse(status="ok")


@lru_cache(maxsize=1)
def _migration_head() -> str:
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "alembic"))
    return ScriptDirectory.from_config(config).get_current_head() or ""


@router.get(
    "/health/ready", response_model=HealthResponse, responses={503: {"model": HealthResponse}}
)
def ready() -> HealthResponse | JSONResponse:
    """Readiness: the database answers and its schema is at the revision this code expects.

    A deploy whose migrations did not run, or a database that is unreachable, reports 503 here and a
    generic message only (never the connection string or the SQL error).
    """
    try:
        with engine.connect() as connection:
            current = connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
        if current != _migration_head():
            logger.error("Readiness failed: the database schema is not at the expected revision.")
            return JSONResponse(status_code=503, content={"status": "schema_out_of_date"})
    except Exception:
        logger.error("Readiness failed: the database is unreachable or not migrated.")
        return JSONResponse(status_code=503, content={"status": "database_unavailable"})
    return HealthResponse(status="ok")
