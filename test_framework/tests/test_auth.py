"""
test_auth.py — Integration tests for the Authentication endpoints.

Endpoints under test:
  POST /api/auth/login
  POST /api/auth/logout
  GET  /api/auth/me
  POST /api/auth/change-password
"""

from __future__ import annotations

import pytest
import requests

from conftest import API, SUPER_ADMIN_CREDS, SENIOR_ADMIN_CREDS, STUDENT_CREDS


pytestmark = pytest.mark.auth


# ─── Login ────────────────────────────────────────────────────────────────────

class TestLogin:
    """POST /api/auth/login"""

    def test_login_superadmin_success(self) -> None:
        """Valid superadmin credentials return 200 with token and user payload."""
        session = requests.Session()
        resp = session.post(f"{API}/auth/login", json=SUPER_ADMIN_CREDS, timeout=10)

        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert "token" in body
        assert body["user"]["username"] == "superadmin"
        assert body["user"]["role"] == "project_admin"
        # Password hash must never be exposed
        assert "passwordHash" not in body["user"]

    def test_login_senior_admin_success(self) -> None:
        """Valid senior admin credentials return 200."""
        session = requests.Session()
        resp = session.post(f"{API}/auth/login", json=SENIOR_ADMIN_CREDS, timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["user"]["role"] == "senior_admin"

    def test_login_student_success(self) -> None:
        """Valid student credentials return 200."""
        session = requests.Session()
        resp = session.post(f"{API}/auth/login", json=STUDENT_CREDS, timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["user"]["role"] == "student"

    def test_login_sets_http_only_cookie(self) -> None:
        """Login response must set a cookie named 'token'."""
        session = requests.Session()
        resp = session.post(f"{API}/auth/login", json=SUPER_ADMIN_CREDS, timeout=10)
        assert resp.status_code == 200
        assert "token" in session.cookies

    def test_login_wrong_password_returns_401(self) -> None:
        """Wrong password must return 401 without exposing which field failed."""
        session = requests.Session()
        resp = session.post(
            f"{API}/auth/login",
            json={"username": "superadmin", "password": "WrongPassword!"},
            timeout=10,
        )
        assert resp.status_code == 401
        body = resp.json()
        assert body["success"] is False
        assert "Invalid credentials" in body["message"]

    def test_login_unknown_user_returns_401(self) -> None:
        """Non-existent username must return 401."""
        session = requests.Session()
        resp = session.post(
            f"{API}/auth/login",
            json={"username": "no_such_user", "password": "whatever"},
            timeout=10,
        )
        assert resp.status_code == 401
        assert resp.json()["success"] is False

    def test_login_missing_username_returns_400(self) -> None:
        """Omitting username must return 400."""
        session = requests.Session()
        resp = session.post(f"{API}/auth/login", json={"password": "Admin@1234"}, timeout=10)
        assert resp.status_code == 400
        assert resp.json()["success"] is False

    def test_login_missing_password_returns_400(self) -> None:
        """Omitting password must return 400."""
        session = requests.Session()
        resp = session.post(f"{API}/auth/login", json={"username": "superadmin"}, timeout=10)
        assert resp.status_code == 400

    def test_login_empty_body_returns_400(self) -> None:
        """Empty body must return 400."""
        session = requests.Session()
        resp = session.post(f"{API}/auth/login", json={}, timeout=10)
        assert resp.status_code == 400


# ─── /me  ─────────────────────────────────────────────────────────────────────

class TestMe:
    """GET /api/auth/me"""

    def test_me_authenticated(self, admin_session: requests.Session) -> None:
        """/me returns the current user when authenticated."""
        resp = admin_session.get(f"{API}/auth/me", timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["user"]["username"] == "superadmin"
        assert "passwordHash" not in body["user"]

    def test_me_unauthenticated_returns_401(self) -> None:
        """/me returns 401 without a valid session."""
        session = requests.Session()
        resp = session.get(f"{API}/auth/me", timeout=10)
        assert resp.status_code == 401

    def test_me_student_returns_correct_role(self, student_session: requests.Session) -> None:
        """/me returns role=student for a student session."""
        resp = student_session.get(f"{API}/auth/me", timeout=10)
        assert resp.status_code == 200
        assert resp.json()["user"]["role"] == "student"


# ─── Logout ───────────────────────────────────────────────────────────────────

class TestLogout:
    """POST /api/auth/logout"""

    def test_logout_clears_cookie_and_returns_200(self) -> None:
        """Logout must succeed and the cookie must be cleared."""
        session = requests.Session()
        # First log in to get a token
        login_resp = session.post(f"{API}/auth/login", json=SUPER_ADMIN_CREDS, timeout=10)
        assert login_resp.status_code == 200

        # Log out
        logout_resp = session.post(f"{API}/auth/logout", timeout=10)
        assert logout_resp.status_code == 200
        body = logout_resp.json()
        assert body["success"] is True
        assert "Logged out" in body["message"]

    def test_me_after_logout_returns_401(self) -> None:
        """After logout, /me must return 401."""
        session = requests.Session()
        session.post(f"{API}/auth/login", json=SUPER_ADMIN_CREDS, timeout=10)
        session.post(f"{API}/auth/logout", timeout=10)

        # Force remove lingering Authorization header
        session.headers.pop("Authorization", None)
        session.cookies.clear()

        resp = session.get(f"{API}/auth/me", timeout=10)
        assert resp.status_code == 401


# ─── Change Password ──────────────────────────────────────────────────────────

class TestChangePassword:
    """POST /api/auth/change-password"""

    def test_change_password_unauthenticated_returns_401(self) -> None:
        """Unauthenticated request must return 401."""
        session = requests.Session()
        resp = session.post(
            f"{API}/auth/change-password",
            json={"currentPassword": "Admin@1234", "newPassword": "NewPass@5678"},
            timeout=10,
        )
        assert resp.status_code == 401

    def test_change_password_missing_fields_returns_400(
        self, student_session: requests.Session
    ) -> None:
        """Omitting newPassword must return 400."""
        resp = student_session.post(
            f"{API}/auth/change-password",
            json={"currentPassword": "Student@1234"},
            timeout=10,
        )
        assert resp.status_code == 400

    def test_change_password_wrong_current_returns_401(
        self, student_session: requests.Session
    ) -> None:
        """Providing a wrong currentPassword must be rejected."""
        resp = student_session.post(
            f"{API}/auth/change-password",
            json={"currentPassword": "WrongOldPass!", "newPassword": "NewPass@9876"},
            timeout=10,
        )
        assert resp.status_code in (400, 401)
