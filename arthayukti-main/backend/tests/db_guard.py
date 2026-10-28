"""The test suite creates and fills tables, so it may only run on a database on this machine."""

from psycopg.conninfo import conninfo_to_dict

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def require_local_database(url: str) -> None:
    """Raise unless every host libpq would connect to is this machine.

    libpq lets `?host=` and `?hostaddr=` in the query override the host in the address, and accepts a
    comma-separated list of hosts, so the URL's own host is not enough. The message never includes the URL.
    """
    plain = url.replace("postgresql+psycopg://", "postgresql://", 1).replace(
        "postgres://", "postgresql://", 1
    )
    try:
        parts = conninfo_to_dict(plain)
    except Exception:
        raise RuntimeError("TEST_DATABASE_URL is not a valid PostgreSQL address.") from None
    hosts = [h for key in ("host", "hostaddr") for h in str(parts.get(key) or "").split(",") if h]
    if not hosts or any(h not in LOCAL_HOSTS for h in hosts):
        raise RuntimeError(
            "TEST_DATABASE_URL must point only at localhost; refusing to run tests elsewhere."
        )
