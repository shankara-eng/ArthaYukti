"""Test environment: a throwaway database built by the real migrations.

The settings are fixed before any test module imports the app, so the suite never touches the
development database (arthayukti.db) and never depends on create_all.
"""

import os
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
_workdir = tempfile.mkdtemp(prefix="arthayukti-tests-")

# Set TEST_DATABASE_URL to run the whole suite on a scratch PostgreSQL. It must be on this machine:
# the suite creates and fills tables, so it refuses any other host rather than risk a real database.
_scratch = os.environ.get("TEST_DATABASE_URL", "").strip()
if _scratch:
    from tests.db_guard import require_local_database

    require_local_database(_scratch)
    os.environ["DATABASE_URL"] = _scratch
else:
    os.environ["DATABASE_URL"] = f"sqlite:///{(Path(_workdir) / 'test.db').as_posix()}"
os.environ["ENVIRONMENT"] = "test"
os.environ["SECRET_KEY"] = "test-signing-key-" + "k" * 40
os.environ["RATE_LIMIT_ENABLED"] = "false"
os.environ["MAIL_BACKEND"] = "memory"
os.environ["SEED_DEMO_USER"] = "false"
os.environ["MARKET_PROVIDER"] = "indian_api"  # the tests stub the Indian-Stock-Market-API contract; a developer's .env may choose yahoo

from alembic.config import Config  # noqa: E402

from alembic import command  # noqa: E402

_config = Config(str(BACKEND / "alembic.ini"))
_config.set_main_option("script_location", str(BACKEND / "alembic"))
command.upgrade(_config, "head")
