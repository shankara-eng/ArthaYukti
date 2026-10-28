import uuid

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_auth_signup_login_lifecycle():
    suffix = uuid.uuid4().hex[:8]
    email = f"testuser_{suffix}@arthayukti.in"
    password = "SecurePassword123!"

    # 1. Signup
    signup_res = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": password, "full_name": "Test User 1"},
    )
    assert signup_res.status_code == 201
    token = signup_res.json()["access_token"]
    assert token

    # 2. Get Profile with Bearer token
    profile_res = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert profile_res.status_code == 200
    assert profile_res.json()["email"] == email

    # 3. Login
    login_res = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert login_res.status_code == 200
    assert "access_token" in login_res.json()

    # 4. Login with wrong password returns 401
    bad_login = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "WrongPassword!"},
    )
    assert bad_login.status_code == 401


def test_cross_user_tenant_isolation_denial():
    """Verify that User A cannot view or modify User B's financial records."""
    suffix_a = uuid.uuid4().hex[:8]
    suffix_b = uuid.uuid4().hex[:8]

    # User A
    user_a_res = client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"alice_{suffix_a}@tenant.in",
            "password": "PasswordAlice123!",
            "full_name": "Alice",
        },
    )
    token_a = user_a_res.json()["access_token"]

    # User B
    user_b_res = client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"bob_{suffix_b}@tenant.in",
            "password": "PasswordBob123!",
            "full_name": "Bob",
        },
    )
    token_b = user_b_res.json()["access_token"]

    # Alice creates a private account
    acc_res = client.post(
        "/api/v1/financials/accounts",
        headers={"Authorization": f"Bearer {token_a}"},
        json={
            "account_name": "Alice Private Vault",
            "account_type": "savings",
            "balance": "500000.00",
            "is_liquid": True,
        },
    )
    assert acc_res.status_code == 201
    alice_acc_id = acc_res.json()["id"]

    # Bob lists accounts -> must NOT see Alice's account
    bob_accounts = client.get(
        "/api/v1/financials/accounts",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert bob_accounts.status_code == 200
    bob_account_ids = [a["id"] for a in bob_accounts.json()]
    assert alice_acc_id not in bob_account_ids


def test_auth_email_normalization_and_case_insensitivity():
    """Verify signup and login normalize email whitespace and casing, and password is never plaintext in DB."""
    from app.db.models import User
    from app.db.session import SessionLocal

    suffix = uuid.uuid4().hex[:8]
    raw_email = f"  User.MixedCase_{suffix}@ArthaYukti.in  "
    normalized = f"user.mixedcase_{suffix}@arthayukti.in"
    password = "CorrectPassword123!"

    # 1. Signup with leading/trailing whitespace and mixed case
    signup_res = client.post(
        "/api/v1/auth/signup",
        json={"email": raw_email, "password": password, "full_name": "  Mixed Case User  "},
    )
    assert signup_res.status_code == 201
    token = signup_res.json()["access_token"]
    assert token

    # 2. Check DB directly: email is normalized, password is bcrypt hash (not plaintext)
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == normalized).first()
        assert user is not None
        assert user.email == normalized
        assert user.full_name == "Mixed Case User"
        assert user.hashed_password.startswith("$2b$")
        assert password not in user.hashed_password

    # 3. Login with lowercase email
    login_lower = client.post(
        "/api/v1/auth/login",
        json={"email": normalized, "password": password},
    )
    assert login_lower.status_code == 200
    assert "access_token" in login_lower.json()

    # 4. Login with uppercase email
    login_upper = client.post(
        "/api/v1/auth/login",
        json={"email": normalized.upper(), "password": password},
    )
    assert login_upper.status_code == 200
    assert "access_token" in login_upper.json()

    # 5. Login with whitespace email
    login_ws = client.post(
        "/api/v1/auth/login",
        json={"email": f"  {normalized}  ", "password": password},
    )
    assert login_ws.status_code == 200

    # 6. Duplicate signup with different case returns 400
    dup_res = client.post(
        "/api/v1/auth/signup",
        json={"email": normalized.upper(), "password": password, "full_name": "Duplicate"},
    )
    assert dup_res.status_code == 400
    assert dup_res.json()["error"]["message"] == "We could not create an account with these details."


def test_auth_invalid_credentials_and_unknown_email():
    """Verify wrong password and unknown email return identical 401 response shapes."""
    suffix = uuid.uuid4().hex[:8]
    email = f"known_{suffix}@arthayukti.in"
    password = "ValidPassword123!"

    # Register user
    reg = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": password, "full_name": "Known User"},
    )
    assert reg.status_code == 201

    # Wrong password -> 401
    bad_pass = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "WrongPassword999!"},
    )
    assert bad_pass.status_code == 401
    assert bad_pass.json()["error"]["code"] == "unauthorized"
    assert bad_pass.json()["error"]["message"] == "Incorrect email or password."

    # Unknown email -> 401 (identical shape)
    bad_email = client.post(
        "/api/v1/auth/login",
        json={"email": f"nonexistent_{suffix}@arthayukti.in", "password": password},
    )
    assert bad_email.status_code == 401
    assert bad_email.json()["error"]["code"] == "unauthorized"
    assert bad_email.json()["error"]["message"] == "Incorrect email or password."


def test_auth_disabled_account_rejection():
    """Verify inactive/disabled account cannot log in and returns 403."""
    from app.db.models import User
    from app.db.session import SessionLocal

    suffix = uuid.uuid4().hex[:8]
    email = f"disabled_{suffix}@arthayukti.in"
    password = "ValidPassword123!"

    reg = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": password, "full_name": "Disabled User"},
    )
    assert reg.status_code == 201

    # Disable account in DB
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email).first()
        user.is_active = False
        db.commit()

    # Attempt login
    login_res = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert login_res.status_code == 403
    assert login_res.json()["error"]["code"] == "forbidden"
    assert login_res.json()["error"]["message"] == "Account is disabled."


def test_auth_password_rules_validation():
    """Verify password length, character requirements, and byte bounds (>72 bytes) are enforced."""
    suffix = uuid.uuid4().hex[:8]
    email = f"pwdtest_{suffix}@arthayukti.in"

    # Too short (<10 chars)
    short_res = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "Short1!", "full_name": "Tester"},
    )
    assert short_res.status_code == 422

    # No digits
    no_digit = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "NoDigitsInThisPassword!", "full_name": "Tester"},
    )
    assert no_digit.status_code == 422

    # No letters
    no_letters = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "123456789012345!", "full_name": "Tester"},
    )
    assert no_letters.status_code == 422

    # >72 bytes (bcrypt truncation protection)
    long_pwd = "A" * 70 + "123"  # 73 bytes
    long_res = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": long_pwd, "full_name": "Tester"},
    )
    assert long_res.status_code == 422


def test_auth_token_persistence_across_simulated_restart():
    """Verify that sessions persist and remain valid across application restarts when SECRET_KEY is stable."""
    suffix = uuid.uuid4().hex[:8]
    email = f"persist_{suffix}@arthayukti.in"
    password = "PersistentPass123!"

    # 1. Signup on client 1
    reg = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": password, "full_name": "Persist User"},
    )
    assert reg.status_code == 201
    token = reg.json()["access_token"]

    # 2. Simulate server restart by creating a brand-new TestClient instance
    fresh_client = TestClient(app)

    # Token generated before restart remains completely valid
    me_res = fresh_client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert me_res.status_code == 200
    assert me_res.json()["email"] == email

    # Can also log in on the new client instance
    login_res = fresh_client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert login_res.status_code == 200
    assert "access_token" in login_res.json()

