"""Signing in with an account that lives in the older dev database (arthayukti_dev.db): development only, read-only, safe."""

import sqlite3
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api import auth as auth_module
from app.config import settings
from app.db.models import User
from app.db.session import SessionLocal
from app.main import app
from app.security import hash_password

PASSWORD = "Legacy-Pass-1234"


def make_legacy(path: Path, email: str, password: str = PASSWORD, active: int = 1, name: str = "Legacy User") -> str:
    user_id = str(uuid.uuid4())
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE users (id TEXT, email TEXT, hashed_password TEXT, full_name TEXT, is_active INTEGER)")
    conn.execute("INSERT INTO users VALUES (?, ?, ?, ?, ?)", (user_id, email, hash_password(password), name, active))
    conn.commit()
    conn.close()
    return user_id


@pytest.fixture()
def dev(tmp_path, monkeypatch):
    legacy = tmp_path / "arthayukti_dev.db"
    monkeypatch.setattr(auth_module, "_legacy_db_path", lambda: legacy)
    monkeypatch.setattr(settings, "ENVIRONMENT", "development")
    return legacy


def login(email: str, password: str):
    return TestClient(app).post("/api/v1/auth/login", json={"email": email, "password": password})


def fresh_email() -> str:
    return f"legacy_{uuid.uuid4().hex[:10]}@example.test"


def stored(email: str):
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email.lower()).first()
        return None if user is None else (user.id, user.hashed_password)


def test_an_account_only_in_the_legacy_file_can_sign_in_and_is_copied(dev):
    email = fresh_email()
    legacy_id = make_legacy(dev, email)
    assert stored(email) is None
    response = login(email, PASSWORD)
    assert response.status_code == 200 and response.json()["access_token"]
    assert stored(email)[0] == legacy_id
    assert login(email, PASSWORD).status_code == 200  # and the next sign-in is ordinary


def test_the_wrong_password_is_still_refused_and_nothing_is_copied(dev):
    email = fresh_email()
    make_legacy(dev, email)
    assert login(email, "Wrong-Pass-1234").status_code == 401
    assert stored(email) is None


def test_an_unknown_email_is_refused(dev):
    make_legacy(dev, fresh_email())
    assert login(fresh_email(), PASSWORD).status_code == 401


def test_the_legacy_password_replaces_the_current_one_for_the_same_email_in_development(dev):
    email = fresh_email()
    with SessionLocal() as db:
        db.add(User(id=str(uuid.uuid4()), email=email, hashed_password=hash_password("Current-Pass-1234"), full_name="Now", is_active=True, is_verified=False))
        db.commit()
    make_legacy(dev, email, password=PASSWORD)
    assert login(email, "Current-Pass-1234").status_code == 200  # the current password keeps working until the legacy one is used
    assert login(email, PASSWORD).status_code == 200


def test_it_does_nothing_outside_development(dev, monkeypatch):
    email = fresh_email()
    make_legacy(dev, email)
    for environment in ("production", "staging", "test"):
        monkeypatch.setattr(settings, "ENVIRONMENT", environment)
        assert login(email, PASSWORD).status_code == 401
        assert stored(email) is None


def test_the_legacy_file_is_never_changed(dev):
    email = fresh_email()
    make_legacy(dev, email)
    before = dev.read_bytes()
    login(email, PASSWORD)
    login(email, "Wrong-Pass-1234")
    assert dev.read_bytes() == before


def test_a_missing_or_broken_legacy_file_is_a_normal_refusal(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "ENVIRONMENT", "development")
    email = fresh_email()
    monkeypatch.setattr(auth_module, "_legacy_db_path", lambda: tmp_path / "nope.db")
    assert login(email, PASSWORD).status_code == 401
    broken = tmp_path / "broken.db"
    broken.write_bytes(b"this is not a database")
    monkeypatch.setattr(auth_module, "_legacy_db_path", lambda: broken)
    assert login(email, PASSWORD).status_code == 401
    # and the application still works afterwards
    assert TestClient(app).get("/api/v1/health").status_code == 200


def test_an_inactive_legacy_account_does_not_get_in(dev):
    email = fresh_email()
    make_legacy(dev, email, active=0)
    assert login(email, PASSWORD).status_code in (401, 403)


def test_a_legacy_id_that_already_belongs_to_someone_else_fails_safely(dev):
    other_email, email = fresh_email(), fresh_email()
    legacy_id = make_legacy(dev, email)
    with SessionLocal() as db:
        db.add(User(id=legacy_id, email=other_email, hashed_password=hash_password("Other-Pass-1234"), full_name="Other", is_active=True, is_verified=False))
        db.commit()
    assert login(email, PASSWORD).status_code == 401  # the copy cannot happen
    assert login(other_email, "Other-Pass-1234").status_code == 200  # and the session is still healthy
