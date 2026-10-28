import pytest

from tests.db_guard import require_local_database


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://u:p@127.0.0.1:5432/db",
        "postgresql+psycopg://u:p@localhost/db?sslmode=disable",
        "postgres://u:p%40x@[::1]/db",
        "postgresql://u@127.0.0.1/db?host=localhost",
    ],
)
def test_local_addresses_are_accepted(url):
    require_local_database(url)


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://u:p@db.example.com/db",
        "postgresql://u:p@127.0.0.1/db?host=db.example.com",  # the query overrides the host
        "postgresql://u:p@127.0.0.1/db?hostaddr=10.1.2.3",
        "postgresql://u:p@127.0.0.1,db.example.com/db",  # several hosts
        "postgresql://u:s3cr3t@/db",  # no host: libpq would use its default or environment
        "not a url",
    ],
)
def test_anything_else_is_refused_without_echoing_the_address(url):
    with pytest.raises(RuntimeError) as caught:
        require_local_database(url)
    assert "s3cr3t" not in str(caught.value) and "example.com" not in str(caught.value)
