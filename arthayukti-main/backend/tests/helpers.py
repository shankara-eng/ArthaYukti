"""Synthetic users for tests. Nothing here is a real account."""

import uuid

from fastapi.testclient import TestClient

from app.main import app

TEST_PASSWORD = "Synthetic-Pass-123"


def new_user(client: TestClient | None = None, tag: str = "user") -> dict[str, str]:
    """Sign up a fresh synthetic user and return its Authorization header."""
    client = client or TestClient(app)
    email = f"{tag}_{uuid.uuid4().hex[:10]}@example.test"
    response = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": TEST_PASSWORD, "full_name": tag},
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}", "X-Test-Email": email}


def authed_client(tag: str = "user") -> TestClient:
    """A client that is signed in as its own synthetic user."""
    headers = new_user(tag=tag)
    headers.pop("X-Test-Email")
    return TestClient(app, headers=headers)
