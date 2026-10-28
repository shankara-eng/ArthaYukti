"""Regression tests for the security and data-integrity remediation. Synthetic users only."""

import hashlib
import io
import sqlite3
import subprocess
import sys
import tempfile
from contextlib import closing
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import mail, ratelimit
from app.config import KNOWN_PLACEHOLDER_SECRETS, Settings, settings
from app.db.init_db import demo_seed_enabled, seed_demo_user_if_enabled
from app.db.models import Base, PasswordReset, User
from app.db.session import SessionLocal
from app.main import app
from app.security import create_access_token
from tests.helpers import TEST_PASSWORD, authed_client, new_user

BACKEND = Path(__file__).resolve().parents[1]
client = TestClient(app)

# Routes that are public on purpose. Everything else must demand a signed-in user.
PUBLIC_PATHS = {
    ("GET", "/api/v1/health"),
    ("GET", "/api/v1/health/ready"),
    ("GET", "/api/v1/samples"),
    ("GET", "/api/v1/samples/{sample_id}"),
    ("POST", "/api/v1/projections"),
    ("POST", "/api/v1/tradeoffs"),
    ("POST", "/api/v1/fixes"),
    ("POST", "/api/v1/compare"),
    ("POST", "/api/v1/rescue/analyze"),
    ("POST", "/api/v1/ai/consult"),
    ("POST", "/api/v1/ai/parse-intent"),
    ("GET", "/api/v1/market/quotes/{symbol}"),
    ("POST", "/api/v1/auth/signup"),
    ("POST", "/api/v1/auth/login"),
    ("POST", "/api/v1/auth/password-reset/request"),
    ("POST", "/api/v1/auth/password-reset/confirm"),
    ("POST", "/api/v1/debt/amortize"),
    ("POST", "/api/v1/financials/investments/sip-calculator"),
}


def _routes():  # taken from the generated spec so every registered operation is covered
    for path, operations in app.openapi()["paths"].items():
        for method in operations:
            yield method.upper(), path


PROTECTED = sorted(r for r in _routes() if r not in PUBLIC_PATHS)


def _call(method: str, path: str, headers: dict | None = None):
    url = (
        path.replace("{plan_id}", "x")
        .replace("{policy_id}", "x")
        .replace("{escalation_id}", "x")
        .replace("{reminder_id}", "x")
        .replace("{account_id}", "x")
        .replace("{investment_id}", "x")
        .replace("{liability_id}", "x")
        .replace("{transaction_id}", "x")
    )
    kwargs = {"json": {}} if method in ("POST", "PUT") else {}
    return client.request(method, url, headers=headers or {}, **kwargs)


def test_the_protected_route_list_is_not_empty():
    paths = {p for _, p in PROTECTED}
    assert "/api/v1/plans" in paths and "/api/v1/financials/accounts" in paths
    assert "/api/v1/insurance/policies" in paths and "/api/v1/auth/me" in paths
    assert len(PROTECTED) >= 20


@pytest.mark.parametrize(("method", "path"), PROTECTED)
def test_protected_routes_refuse_anonymous_callers(method, path):
    response = _call(method, path)
    assert response.status_code == 401, (method, path, response.text)
    assert response.json()["error"]["code"] == "unauthorized"
    assert response.headers["www-authenticate"] == "Bearer"


def _expired_token() -> str:
    db = SessionLocal()
    try:
        user = db.query(User).first()
        if user is None:
            new_user()
            user = db.query(User).first()
        return create_access_token(user.id, user.email, expires_delta=timedelta(minutes=-5))
    finally:
        db.close()


@pytest.mark.parametrize(
    "header",
    [
        "Basic dXNlcjpwYXNz",  # wrong scheme
        "Bearer",  # no token
        "Bearer not-a-real-token",
        "Token abc",
        "garbage",
    ],
)
def test_malformed_and_invalid_tokens_get_401_on_private_and_public_routes(header):
    for method, path in (
        ("GET", "/api/v1/plans"),
        ("GET", "/api/v1/auth/me"),
        ("POST", "/api/v1/rescue/analyze"),
    ):
        assert _call(method, path, {"Authorization": header}).status_code == 401, (header, path)


def test_expired_tokens_get_401_not_a_shared_account():
    headers = {"Authorization": f"Bearer {_expired_token()}"}
    for method, path in (
        ("GET", "/api/v1/plans"),
        ("GET", "/api/v1/financials/accounts"),
        ("POST", "/api/v1/rescue/analyze"),
    ):
        assert _call(method, path, headers).status_code == 401, path


def test_a_token_for_a_deleted_user_is_refused():
    headers = new_user(tag="gone")
    token_headers = {"Authorization": headers["Authorization"]}
    assert client.delete("/api/v1/auth/delete-account", headers=token_headers).status_code == 200
    assert client.get("/api/v1/auth/me", headers=token_headers).status_code == 401


def test_public_sample_and_calculation_routes_stay_open_to_anonymous_callers():
    assert client.get("/api/v1/samples/household").status_code == 200
    assert client.get("/api/v1/health").status_code == 200


# ---- tenancy ---------------------------------------------------------------------------


def _policy_and_escalation(headers, number):
    policy = client.post(
        "/api/v1/insurance/policies",
        headers=headers,
        json={
            "policy_number": number,
            "policy_type": "term_life",
            "insurer_name": "SyntheticCo",
            "plan_name": "Synthetic term",
            "start_date": "2027-01-01",
            "base_sum_assured": "1000000.00",
            "premium_amount": "10000.00",
        },
    ).json()
    escalation = client.post(
        "/api/v1/insurance/escalations",
        headers=headers,
        json={
            "policy_id": policy["id"],
            "escalation_type": "fixed_amount",
            "fixed_escalation_amount": "100000.00",
            "first_escalation_date": "2028-01-01",
        },
    ).json()
    return policy, escalation


def test_two_users_can_use_the_same_idempotency_key_without_seeing_each_other():
    a, b = new_user(tag="a"), new_user(tag="b")
    for h in (a, b):
        h.pop("X-Test-Email")
    _, esc_a = _policy_and_escalation(a, "SYN-A-1")
    _, esc_b = _policy_and_escalation(b, "SYN-B-1")
    body = {"idempotency_key": "shared-key-1", "effective_date": "2028-01-01"}

    ra = client.post(
        f"/api/v1/insurance/escalations/{esc_a['id']}/process-event", headers=a, json=body
    )
    rb = client.post(
        f"/api/v1/insurance/escalations/{esc_b['id']}/process-event", headers=b, json=body
    )
    assert ra.status_code == rb.status_code == 200
    assert ra.json()["escalation_id"] == esc_a["id"]
    assert rb.json()["escalation_id"] == esc_b["id"]  # B got B's own record, not A's
    assert ra.json()["id"] != rb.json()["id"]

    # B's event really ran, and A cannot read B's history or the other way round.
    assert (
        len(client.get(f"/api/v1/insurance/escalations/{esc_b['id']}/history", headers=b).json())
        == 1
    )
    assert (
        client.get(f"/api/v1/insurance/escalations/{esc_b['id']}/history", headers=a).status_code
        == 404
    )
    assert client.get(f"/api/v1/insurance/escalations/{esc_a['id']}", headers=b).status_code == 404


def test_repeating_a_key_on_the_same_escalation_does_not_apply_it_twice():
    h = new_user(tag="idem")
    h.pop("X-Test-Email")
    _, esc = _policy_and_escalation(h, "SYN-I-1")
    body = {"idempotency_key": "once", "effective_date": "2028-01-01"}
    first = client.post(
        f"/api/v1/insurance/escalations/{esc['id']}/process-event", headers=h, json=body
    ).json()
    again = client.post(
        f"/api/v1/insurance/escalations/{esc['id']}/process-event", headers=h, json=body
    ).json()
    assert first["id"] == again["id"]
    assert (
        len(client.get(f"/api/v1/insurance/escalations/{esc['id']}/history", headers=h).json()) == 1
    )


def test_plans_and_accounts_are_private_to_their_owner():
    a, b = new_user(tag="pa"), new_user(tag="pb")
    for h in (a, b):
        h.pop("X-Test-Email")
    account = client.post(
        "/api/v1/financials/accounts",
        headers=a,
        json={"account_name": "A only", "account_type": "savings", "balance": "10.00"},
    ).json()
    assert [x["id"] for x in client.get("/api/v1/financials/accounts", headers=b).json()] == []
    assert account["id"] in [
        x["id"] for x in client.get("/api/v1/financials/accounts", headers=a).json()
    ]


# ---- accounts and passwords -----------------------------------------------------------------


def _signup(email: str, password: str = TEST_PASSWORD):
    return client.post("/api/v1/auth/signup", json={"email": email, "password": password})


@pytest.mark.parametrize(
    "password", ["short1", "alllettersnodigits", "1234567890123", "x" * 80 + "1"]
)
def test_weak_or_oversized_passwords_are_rejected(password):
    assert _signup("pw@example.test", password).status_code == 422


@pytest.mark.parametrize("email", ["not-an-email", "a@b", "a b@c.com", "", "@x.com"])
def test_invalid_emails_are_rejected(email):
    assert _signup(email).status_code == 422


def test_login_does_not_reveal_whether_an_address_exists():
    email = new_user(tag="known")["X-Test-Email"]
    wrong = client.post("/api/v1/auth/login", json={"email": email, "password": "Wrong-Pass-999"})
    unknown = client.post(
        "/api/v1/auth/login", json={"email": "nobody@example.test", "password": "Wrong-Pass-999"}
    )
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


def test_signup_duplicate_message_is_generic():
    email = new_user(tag="dupe")["X-Test-Email"]
    again = _signup(email)
    assert again.status_code == 400
    assert "already" not in again.json()["error"]["message"].lower()


def test_new_accounts_are_not_marked_verified():
    email = new_user(tag="unverified")["X-Test-Email"]
    db = SessionLocal()
    try:
        assert db.query(User).filter(User.email == email).one().is_verified is False
    finally:
        db.close()


def _reset_token_from_mail() -> str:
    return mail.outbox[-1]["token"]


def test_password_reset_round_trip_expiry_reuse_and_secrecy(caplog):
    email = new_user(tag="reset")["X-Test-Email"]
    mail.outbox.clear()
    caplog.set_level("DEBUG")

    response = client.post("/api/v1/auth/password-reset/request", json={"email": email})
    assert response.status_code == 200
    token = _reset_token_from_mail()
    assert token not in response.text  # never returned by the API
    assert token not in caplog.text  # never logged

    db = SessionLocal()
    try:
        stored = db.query(PasswordReset).order_by(PasswordReset.created_at.desc()).first()
        assert stored.token_hash == hashlib.sha256(token.encode()).hexdigest()
        assert token not in (stored.token_hash or "")
    finally:
        db.close()

    new_password = "Brand-New-Pass-456"
    ok = client.post(
        "/api/v1/auth/password-reset/confirm", json={"token": token, "new_password": new_password}
    )
    assert ok.status_code == 200
    assert (
        client.post(
            "/api/v1/auth/login", json={"email": email, "password": new_password}
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/v1/auth/login", json={"email": email, "password": TEST_PASSWORD}
        ).status_code
        == 401
    )

    reused = client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": token, "new_password": "Another-Pass-789"},
    )
    assert reused.status_code == 400

    invalid = client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": "x" * 43, "new_password": "Another-Pass-789"},
    )
    assert invalid.status_code == 400
    assert invalid.json() == reused.json()  # no hint about which case it was


def test_an_expired_reset_token_is_refused_with_400_not_500():
    email = new_user(tag="expiry")["X-Test-Email"]
    mail.outbox.clear()
    client.post("/api/v1/auth/password-reset/request", json={"email": email})
    token = _reset_token_from_mail()
    db = SessionLocal()
    try:
        record = db.query(PasswordReset).order_by(PasswordReset.created_at.desc()).first()
        record.expires_at = datetime.now(UTC) - timedelta(minutes=1)
        db.commit()
    finally:
        db.close()
    late = client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": token, "new_password": "Late-Pass-12345"},
    )
    assert late.status_code == 400


def test_using_one_reset_link_invalidates_the_others():
    email = new_user(tag="twolinks")["X-Test-Email"]
    mail.outbox.clear()
    client.post("/api/v1/auth/password-reset/request", json={"email": email})
    first = _reset_token_from_mail()
    client.post("/api/v1/auth/password-reset/request", json={"email": email})
    second = _reset_token_from_mail()
    assert (
        client.post(
            "/api/v1/auth/password-reset/confirm",
            json={"token": first, "new_password": "Fresh-Pass-12345"},
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/v1/auth/password-reset/confirm",
            json={"token": second, "new_password": "Other-Pass-12345"},
        ).status_code
        == 400
    )


def test_reset_for_an_unknown_address_answers_the_same_and_sends_nothing():
    mail.outbox.clear()
    known = new_user(tag="samebody")["X-Test-Email"]
    a = client.post("/api/v1/auth/password-reset/request", json={"email": known})
    sent = len(mail.outbox)
    b = client.post("/api/v1/auth/password-reset/request", json={"email": "ghost@example.test"})
    assert a.status_code == b.status_code == 200 and a.json() == b.json()
    assert sent == 1 and len(mail.outbox) == 1


def test_reset_is_reported_unavailable_when_no_mail_transport_is_configured(monkeypatch):
    monkeypatch.setattr(settings, "MAIL_BACKEND", "disabled")
    email = new_user(tag="nomail")["X-Test-Email"]
    response = client.post("/api/v1/auth/password-reset/request", json={"email": email})
    assert response.status_code == 503
    assert "not available" in response.json()["error"]["message"]


def test_login_attempts_are_rate_limited(monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_ENABLED", True)
    ratelimit.reset_for_tests()
    email = new_user(tag="limited")["X-Test-Email"]
    codes = [
        client.post(
            "/api/v1/auth/login", json={"email": email, "password": "Wrong-Pass-999"}
        ).status_code
        for _ in range(12)
    ]
    assert codes[:10] == [401] * 10
    assert codes[10] == 429
    blocked = client.post("/api/v1/auth/login", json={"email": email, "password": TEST_PASSWORD})
    assert blocked.status_code == 429 and int(blocked.headers["retry-after"]) > 0
    ratelimit.reset_for_tests()


# ---- configuration and seeding ---------------------------------------------------------------


@pytest.mark.parametrize("secret", ["", "short", *sorted(KNOWN_PLACEHOLDER_SECRETS)])
def test_production_refuses_to_start_without_a_strong_secret(secret):
    with pytest.raises(ValueError, match="SECRET_KEY"):
        Settings(_env_file=None, ENVIRONMENT="production", SECRET_KEY=secret)


def test_production_accepts_a_strong_secret_and_development_never_uses_a_published_one():
    assert (
        Settings(_env_file=None, ENVIRONMENT="production", SECRET_KEY="s" * 48).SECRET_KEY
        == "s" * 48
    )
    dev = Settings(_env_file=None, ENVIRONMENT="development", SECRET_KEY="")
    assert len(dev.SECRET_KEY) >= 32 and dev.SECRET_KEY not in KNOWN_PLACEHOLDER_SECRETS
    other = Settings(_env_file=None, ENVIRONMENT="development", SECRET_KEY="")
    assert dev.SECRET_KEY != other.SECRET_KEY


def test_the_old_published_demo_credentials_do_not_work():
    response = client.post(
        "/api/v1/auth/login", json={"email": "demo@arthayukti.in", "password": "DemoPassword123!"}
    )
    assert response.status_code == 401


def test_demo_account_needs_development_a_flag_and_its_own_password(monkeypatch):
    assert demo_seed_enabled() is False
    monkeypatch.setattr(settings, "ENVIRONMENT", "development")
    monkeypatch.setattr(settings, "SEED_DEMO_USER", True)
    monkeypatch.setattr(settings, "DEMO_USER_PASSWORD", "short")
    assert demo_seed_enabled() is False
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "DEMO_USER_PASSWORD", "a-long-enough-demo-password")
    assert demo_seed_enabled() is False and seed_demo_user_if_enabled() is False
    monkeypatch.setattr(settings, "ENVIRONMENT", "development")
    assert demo_seed_enabled() is True


# ---- migrations ------------------------------------------------------------------------------


def _run(args: list[str], db_url: str):
    env = {
        "DATABASE_URL": db_url,
        "ENVIRONMENT": "test",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PATH": "",
    }
    import os

    env = {**os.environ, **env}
    return subprocess.run(args, cwd=BACKEND, env=env, capture_output=True, text=True, timeout=120)


def test_a_fresh_database_is_built_by_alembic_alone():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as folder:
        db_file = Path(folder) / "fresh.db"
        url = f"sqlite:///{db_file.as_posix()}"
        result = _run([sys.executable, "-m", "alembic", "upgrade", "head"], url)
        assert result.returncode == 0, result.stderr
        with closing(sqlite3.connect(db_file)) as conn:
            tables = {
                r[0] for r in conn.execute("select name from sqlite_master where type='table'")
            }
        assert tables == set(Base.metadata.tables) | {"alembic_version"}
        # No drift between the models and what the migration built.
        check = _run([sys.executable, "-m", "alembic", "check"], url)
        assert check.returncode == 0, check.stdout + check.stderr


def test_importing_the_app_does_not_create_a_schema():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as folder:
        db_file = Path(folder) / "untouched.db"
        url = f"sqlite:///{db_file.as_posix()}"
        result = _run([sys.executable, "-c", "import app.main"], url)
        assert result.returncode == 0, result.stderr
        if db_file.exists():
            with closing(sqlite3.connect(db_file)) as conn:
                tables = [
                    r[0] for r in conn.execute("select name from sqlite_master where type='table'")
                ]
            assert tables == []


# ---- CSV import --------------------------------------------------------------------------


def _import(csv_text: bytes | str, headers=None):
    data = csv_text.encode() if isinstance(csv_text, str) else csv_text
    c = headers or authed_client(tag="csv")
    return c, c.post(
        "/api/v1/financials/transactions/import",
        files={"file": ("t.csv", io.BytesIO(data), "text/csv")},
    )


GOOD = "date,amount,type,category,description,is_essential\n2027-01-05,1250.50,debit,Food,Groceries,true\n"


def test_a_valid_csv_is_imported_with_exact_amounts():
    c, response = _import(GOOD)
    assert response.status_code == 200
    assert response.json() == {
        "imported_count": 1,
        "failed_count": 0,
        "duplicate_count": 0,
        "errors": [],
        "errors_truncated": False,
    }
    rows = c.get("/api/v1/financials/transactions").json()
    assert [r["amount"] for r in rows] == ["1250.50"]


@pytest.mark.parametrize(
    ("row", "message"),
    [
        ("2027-01-05,Infinity,debit", "finite"),
        ("2027-01-05,NaN,debit", "finite"),
        ("2027-01-05,-500,credit", "greater than zero"),
        ("2027-01-05,0,debit", "greater than zero"),
        ("2027-01-05,12.345,debit", "2 decimal places"),
        ("2027-01-05,abc,debit", "not a number"),
        ("2027-13-45,10,debit", "real date"),
        ("not-a-date,10,debit", "real date"),
        ("2027-01-05,10,sideways", "credit or debit"),
        ("2027-01-05,999999999999,debit", "maximum"),
    ],
)
def test_invalid_rows_are_rejected_not_corrected(row, message):
    c, response = _import(f"date,amount,type\n{row}\n")
    body = response.json()
    assert response.status_code == 200
    assert body["imported_count"] == 0 and body["failed_count"] == 1
    assert message in body["errors"][0]
    assert c.get("/api/v1/financials/transactions").json() == []


def test_duplicates_are_skipped_and_counted():
    c, first = _import(GOOD)
    _, again = _import(GOOD, headers=c)
    assert first.json()["imported_count"] == 1
    assert again.json()["imported_count"] == 0 and again.json()["duplicate_count"] == 1
    twice = "date,amount,type\n2027-02-01,10,debit\n2027-02-01,10,debit\n"
    _, within = _import(twice, headers=c)
    assert within.json()["imported_count"] == 1 and within.json()["duplicate_count"] == 1


def test_oversized_and_overlong_files_and_wrong_encoding_are_refused():
    _, big = _import(b"date,amount,type\n" + b"2027-01-01,1,debit\n" * 60000)
    assert big.status_code == 413
    _, many = _import("date,amount,type\n" + "2027-01-01,1,debit\n" * 5001)
    assert many.status_code == 422 and many.json()["error"]["code"] == "too_many_rows"
    _, latin = _import(b"date,amount,type\n2027-01-01,1,debit,\xe9\n\xff\xfe")
    assert latin.status_code == 422 and latin.json()["error"]["code"] == "invalid_encoding"
    _, headerless = _import("foo,bar\n1,2\n")
    assert headerless.status_code == 422


def test_error_lists_are_capped():
    rows = "".join("2027-01-05,abc,debit\n" for _ in range(80))
    _, response = _import("date,amount,type\n" + rows)
    body = response.json()
    assert (
        body["failed_count"] == 80
        and len(body["errors"]) == 50
        and body["errors_truncated"] is True
    )


def test_csv_import_requires_sign_in():
    response = client.post(
        "/api/v1/financials/transactions/import",
        files={"file": ("t.csv", io.BytesIO(GOOD.encode()), "text/csv")},
    )
    assert response.status_code == 401


# ---- input validation --------------------------------------------------------------------


def _policy(**changes):
    body = {
        "policy_number": "POL-1",
        "policy_type": "home",
        "insurer_name": "SyntheticCo",
        "plan_name": "Plan",
        "start_date": "2027-01-01",
        "base_sum_assured": "100.00",
        "premium_amount": "10.00",
    }
    return {**body, **changes}


@pytest.mark.parametrize(
    "changes",
    [
        {"start_date": "garbage"},
        {"start_date": "2027-02-30"},
        {"renewal_date": "01/02/2027"},
        {"policy_number": "X" * 5000},
        {"policy_number": ""},
        {"insurer_name": "x" * 500},
    ],
)
def test_policy_fields_are_validated(changes):
    c = authed_client(tag="val")
    assert c.post("/api/v1/insurance/policies", json=_policy(**changes)).status_code == 422


def test_an_escalation_event_with_a_bad_date_is_a_422_not_a_crash():
    h = new_user(tag="baddate")
    h.pop("X-Test-Email")
    _, esc = _policy_and_escalation(h, "SYN-D-1")
    response = client.post(
        f"/api/v1/insurance/escalations/{esc['id']}/process-event",
        headers=h,
        json={"effective_date": "not-a-date"},
    )
    assert response.status_code == 422


def test_requests_over_the_size_limit_are_refused():
    response = client.post(
        "/api/v1/projections",
        content=b"x" * (settings.MAX_REQUEST_BYTES + 10),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"


# ---- contract ----------------------------------------------------------------------------


def test_openapi_declares_bearer_auth_and_error_shapes():
    spec = app.openapi()
    assert spec["components"]["securitySchemes"]["HTTPBearer"]["scheme"] == "bearer"
    protected = spec["paths"]["/api/v1/plans"]["get"]
    assert "401" in protected["responses"] and protected["security"]
    for path, ops in spec["paths"].items():
        for method, op in ops.items():
            schema = op["responses"].get("200", op["responses"].get("201", {}))
            content = schema.get("content", {}).get("application/json", {}).get("schema", {})
            assert content != {"type": "object", "additionalProperties": True} or not content, (
                f"{method.upper()} {path} returns an untyped object"
            )


# ---- findings from the post-commit verification --------------------------------------------


def test_a_transaction_can_only_reference_the_callers_own_account():
    owner, other = authed_client(tag="txowner"), authed_client(tag="txother")
    account = owner.post(
        "/api/v1/financials/accounts",
        json={"account_name": "Owner vault", "account_type": "savings", "balance": "500.00"},
    ).json()
    body = {
        "transaction_date": "2027-01-01",
        "amount": "100.00",
        "transaction_type": "credit",
        "category": "x",
    }

    foreign = other.post(
        "/api/v1/financials/transactions", json={**body, "account_id": account["id"]}
    )
    missing = other.post(
        "/api/v1/financials/transactions", json={**body, "account_id": "no-such-id"}
    )
    assert foreign.status_code == missing.status_code == 404
    assert foreign.json() == missing.json()  # no way to tell "not yours" from "does not exist"

    balances = [a["balance"] for a in owner.get("/api/v1/financials/accounts").json()]
    assert balances == ["500.00"]
    assert owner.get("/api/v1/financials/transactions").json() == []
    assert other.get("/api/v1/financials/transactions").json() == []  # nothing was stored

    own = owner.post("/api/v1/financials/transactions", json={**body, "account_id": account["id"]})
    assert own.status_code == 201 and own.json()["account_id"] == account["id"]
    assert [a["balance"] for a in owner.get("/api/v1/financials/accounts").json()] == ["600.00"]

    unlinked = other.post("/api/v1/financials/transactions", json=body)
    assert unlinked.status_code == 201 and unlinked.json()["account_id"] is None


def test_a_mail_failure_gives_the_same_answer_and_leaves_no_usable_token(monkeypatch, caplog):
    email = new_user(tag="outage")["X-Test-Email"]

    def smtp_down(to_email: str, token: str) -> None:
        raise OSError("smtp down")

    monkeypatch.setattr(mail, "send_password_reset", smtp_down)
    caplog.set_level("DEBUG")
    known = client.post("/api/v1/auth/password-reset/request", json={"email": email})
    unknown = client.post(
        "/api/v1/auth/password-reset/request", json={"email": "ghost-outage@example.test"}
    )
    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json()

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).one()
        pending = (
            db.query(PasswordReset)
            .filter(PasswordReset.user_id == user.id, PasswordReset.used.is_(False))
            .count()
        )
        assert pending == 0  # the undelivered token cannot be used
    finally:
        db.close()
    assert "OSError" in caplog.text  # the failure is logged...
    assert email not in caplog.text  # ...without the address


def test_the_contract_says_the_token_is_optional_on_the_rescue_route_only():
    spec = app.openapi()
    rescue = spec["paths"]["/api/v1/rescue/analyze"]["post"]
    assert rescue["security"] == [{"HTTPBearer": []}, {}]
    required = {
        (method.upper(), path)
        for path, ops in spec["paths"].items()
        for method, op in ops.items()
        if op.get("security") == [{"HTTPBearer": []}]
    }
    assert required == set(PROTECTED)  # every other secured operation really requires sign-in
    plan = client.get("/api/v1/samples/tiny_delayed_goal").json()["plan"]
    assert client.post("/api/v1/rescue/analyze", json={"plan": plan}).status_code == 200


# ---- deployment settings -----------------------------------------------------------------


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("postgres://u:p@host:5432/db", "postgresql+psycopg://u:p@host:5432/db"),
        ("postgresql://u:p@host/db", "postgresql+psycopg://u:p@host/db"),
        ("postgresql+psycopg://u:p@host/db", "postgresql+psycopg://u:p@host/db"),
        ("sqlite:///./x.db", "sqlite:///./x.db"),
        ("", "sqlite:///./arthayukti.db"),
        ("   ", "sqlite:///./arthayukti.db"),
    ],
)
def test_database_urls_are_normalised(given, expected):
    assert Settings(_env_file=None, DATABASE_URL=given).DATABASE_URL == expected


def test_readiness_reports_ok_when_the_schema_is_current():
    client = TestClient(app)
    assert client.get("/api/v1/health").json() == {"status": "ok"}
    assert client.get("/api/v1/health/ready").json() == {"status": "ok"}


def test_readiness_refuses_when_the_schema_is_behind_or_the_database_is_down(monkeypatch):
    from app.api import health

    client = TestClient(app)
    monkeypatch.setattr(health, "_migration_head", lambda: "some-newer-revision")
    behind = client.get("/api/v1/health/ready")
    assert behind.status_code == 503 and behind.json() == {"status": "schema_out_of_date"}

    class Broken:
        def connect(self):
            raise RuntimeError("password=hunter2 host=db.example")

    monkeypatch.setattr(health, "engine", Broken())
    down = client.get("/api/v1/health/ready")
    assert down.status_code == 503 and down.json() == {"status": "database_unavailable"}
    assert "hunter2" not in down.text
    assert client.get("/api/v1/health").status_code == 200  # liveness is independent of the database
