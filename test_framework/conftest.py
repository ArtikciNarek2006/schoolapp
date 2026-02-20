"""
conftest.py — Shared fixtures for MyMobileApp integration test suite.

Provides:
  - Authenticated requests.Session fixtures for each role.
  - Shared known-good realm / group IDs discovered from seeded data.
  - A socket.io client factory fixture for WebSocket tests.
"""

from __future__ import annotations

import os
import time
from typing import Generator

import pytest
import requests
import socketio as sio  # python-socketio[client]

# ─── configuration ────────────────────────────────────────────────────────────

BASE_URL: str = os.getenv("TEST_BASE_URL", "http://localhost:3000")
API: str = f"{BASE_URL}/api"

# Seeded credentials (from db/seed.js and data/users.json)
SUPER_ADMIN_CREDS: dict = {"username": "superadmin", "password": "Admin@1234"}

# Seeded realm IDs (present in data/realms.json)
SEEDED_REALM_ID: str = "078d5839-0261-40c7-87b2-f858f3a4b7ac"  # Test School Class 2B
SEEDED_REALM_CODE: str = "TS-2B"

# Seeded senior admin for SEEDED_REALM_ID
SENIOR_ADMIN_CREDS: dict = {"username": "teacher.two", "password": "Teacher@1234"}

# Seeded student for SEEDED_REALM_ID
STUDENT_CREDS: dict = {"username": "bob.student", "password": "Student@1234"}

# Seeded group inside SEEDED_REALM_ID (General group auto-created with realm)
# We discover this dynamically via the API in session-scoped fixture below.


# ─── helper ───────────────────────────────────────────────────────────────────

def _make_session(credentials: dict) -> requests.Session:
    """Return a requests.Session authenticated with *credentials*."""
    session = requests.Session()
    resp = session.post(f"{API}/auth/login", json=credentials, timeout=10)
    if resp.status_code != 200:
        raise RuntimeError(
            f"Login failed for {credentials['username']!r}: "
            f"{resp.status_code} {resp.text}"
        )
    # The server sets an HttpOnly cookie; requests.Session persists it automatically.
    # Optionally also set Authorization header from body token for belt-and-suspenders.
    token: str | None = resp.json().get("token")
    if token:
        session.headers.update({"Authorization": f"Bearer {token}"})
    return session


# ─── session-scoped auth fixtures ─────────────────────────────────────────────

@pytest.fixture(scope="session")
def admin_session() -> Generator[requests.Session, None, None]:
    """Project Admin (superadmin) — manages realms, no realm membership."""
    session = _make_session(SUPER_ADMIN_CREDS)
    yield session
    session.post(f"{API}/auth/logout", timeout=5)
    session.close()


@pytest.fixture(scope="session")
def senior_session() -> Generator[requests.Session, None, None]:
    """Senior Admin (realm admin) for SEEDED_REALM_ID."""
    session = _make_session(SENIOR_ADMIN_CREDS)
    yield session
    session.post(f"{API}/auth/logout", timeout=5)
    session.close()


@pytest.fixture(scope="session")
def student_session() -> Generator[requests.Session, None, None]:
    """Student — member of SEEDED_REALM_ID."""
    session = _make_session(STUDENT_CREDS)
    yield session
    session.post(f"{API}/auth/logout", timeout=5)
    session.close()


# ─── shared realm / group discovery ──────────────────────────────────────────

@pytest.fixture(scope="session")
def realm_id() -> str:
    """Return the stable seeded realm ID used throughout the suite."""
    return SEEDED_REALM_ID


@pytest.fixture(scope="session")
def general_group_id(senior_session: requests.Session) -> str:
    """Return the ID of the General group inside SEEDED_REALM_ID."""
    resp = senior_session.get(
        f"{API}/realms/{SEEDED_REALM_ID}/groups",
        params={"all": "true"},
        timeout=10,
    )
    assert resp.status_code == 200, f"Could not list groups: {resp.text}"
    groups = resp.json()["data"]
    general = next((g for g in groups if g["type"] == "general"), None)
    assert general is not None, "No general group found in seeded realm"
    return general["id"]


# ─── socket.io client factory ─────────────────────────────────────────────────

@pytest.fixture(scope="function")
def socket_client_factory():
    """
    Factory that creates an authenticated socket.io client.

    Usage inside a test::

        def test_something(socket_client_factory, admin_session):
            token = admin_session.cookies.get("token") or ...
            client = socket_client_factory(token)
            ...
            client.disconnect()
    """
    clients: list[sio.SimpleClient] = []

    def _factory(token: str) -> sio.SimpleClient:
        client = sio.SimpleClient()
        client.connect(
            BASE_URL,
            auth={"token": token},
            transports=["websocket"],
            wait_timeout=10,
        )
        clients.append(client)
        return client

    yield _factory

    # tear-down: disconnect all clients created in this test
    for client in clients:
        try:
            client.disconnect()
        except Exception:
            pass


# ─── helper to extract token from a session ──────────────────────────────────

def get_token_from_session(session: requests.Session) -> str:
    """Extract the JWT token stored in the session's cookie jar."""
    token = session.cookies.get("token")
    if not token:
        # Fall back to Authorization header
        auth_header = session.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[len("Bearer "):]
    assert token, "No token found in session"
    return token
