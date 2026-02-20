"""
test_users.py — Integration tests for User management inside a realm.

Endpoints under test:
  GET    /api/realms/:realmId/users
  POST   /api/realms/:realmId/users
  GET    /api/realms/:realmId/users/:userId
  PATCH  /api/realms/:realmId/users/:userId
  DELETE /api/realms/:realmId/users/:userId
"""

from __future__ import annotations

import uuid

import pytest
import requests

from conftest import API, SEEDED_REALM_ID, STUDENT_CREDS

pytestmark = pytest.mark.users

_REALM = SEEDED_REALM_ID


def _user_payload() -> dict:
    uname = f"stu_{uuid.uuid4().hex[:6]}"
    return {
        "username": uname,
        "password": "Student@1234",
        "displayName": f"Test Student {uname}",
        "role": "student",
    }


# ─── List users ───────────────────────────────────────────────────────────────

class TestListUsers:
    """GET /api/realms/:realmId/users"""

    def test_senior_admin_can_list_users(self, senior_session: requests.Session) -> None:
        resp = senior_session.get(f"{API}/realms/{_REALM}/users", timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert isinstance(body["data"], list)

    def test_student_cannot_list_users(self, student_session: requests.Session) -> None:
        """Students do not have permission to list all users."""
        resp = student_session.get(f"{API}/realms/{_REALM}/users", timeout=10)
        assert resp.status_code == 403

    def test_unauthenticated_cannot_list_users(self) -> None:
        resp = requests.get(f"{API}/realms/{_REALM}/users", timeout=10)
        assert resp.status_code == 401

    def test_cross_realm_access_denied(self, student_session: requests.Session) -> None:
        """Student of realm TS-2B must not access another realm's users."""
        OTHER_REALM = "2a9865bf-2c41-4e42-a7fd-a8609615d510"  # TS-1A
        resp = student_session.get(f"{API}/realms/{OTHER_REALM}/users", timeout=10)
        assert resp.status_code in (403, 404)


# ─── Create user ──────────────────────────────────────────────────────────────

class TestCreateUser:
    """POST /api/realms/:realmId/users"""

    def test_senior_admin_can_create_student(self, senior_session: requests.Session) -> None:
        payload = _user_payload()
        resp = senior_session.post(f"{API}/realms/{_REALM}/users", json=payload, timeout=10)
        assert resp.status_code == 201
        body = resp.json()
        assert body["success"] is True
        assert body["data"]["username"] == payload["username"]
        assert body["data"]["role"] == "student"
        assert "passwordHash" not in body["data"]

    def test_create_user_missing_username_returns_400(
        self, senior_session: requests.Session
    ) -> None:
        payload = _user_payload()
        del payload["username"]
        resp = senior_session.post(f"{API}/realms/{_REALM}/users", json=payload, timeout=10)
        assert resp.status_code == 400

    def test_create_user_duplicate_username_returns_409(
        self, senior_session: requests.Session
    ) -> None:
        payload = _user_payload()
        r1 = senior_session.post(f"{API}/realms/{_REALM}/users", json=payload, timeout=10)
        assert r1.status_code == 201
        r2 = senior_session.post(f"{API}/realms/{_REALM}/users", json=payload, timeout=10)
        assert r2.status_code == 409

    def test_student_cannot_create_user(self, student_session: requests.Session) -> None:
        payload = _user_payload()
        resp = student_session.post(f"{API}/realms/{_REALM}/users", json=payload, timeout=10)
        assert resp.status_code == 403


# ─── Get single user ──────────────────────────────────────────────────────────

class TestGetUser:
    """GET /api/realms/:realmId/users/:userId"""

    def test_senior_admin_can_get_any_user(self, senior_session: requests.Session) -> None:
        # First list to find a valid userId
        list_resp = senior_session.get(f"{API}/realms/{_REALM}/users", timeout=10)
        users = list_resp.json()["data"]
        assert len(users) > 0
        user_id = users[0]["id"]

        resp = senior_session.get(f"{API}/realms/{_REALM}/users/{user_id}", timeout=10)
        assert resp.status_code == 200
        assert resp.json()["data"]["id"] == user_id

    def test_get_nonexistent_user_returns_404(self, senior_session: requests.Session) -> None:
        fake_id = str(uuid.uuid4())
        resp = senior_session.get(f"{API}/realms/{_REALM}/users/{fake_id}", timeout=10)
        assert resp.status_code == 404

    def test_student_can_get_own_profile(
        self, student_session: requests.Session
    ) -> None:
        """Student can retrieve their own user record via /me first."""
        me_resp = student_session.get(f"{API}/auth/me", timeout=10)
        assert me_resp.status_code == 200
        user_id = me_resp.json()["user"]["id"]

        resp = student_session.get(f"{API}/realms/{_REALM}/users/{user_id}", timeout=10)
        assert resp.status_code == 200
        assert resp.json()["data"]["id"] == user_id


# ─── Update user ──────────────────────────────────────────────────────────────

class TestUpdateUser:
    """PATCH /api/realms/:realmId/users/:userId"""

    def test_student_can_update_own_display_name(
        self, student_session: requests.Session
    ) -> None:
        me_resp = student_session.get(f"{API}/auth/me", timeout=10)
        user_id = me_resp.json()["user"]["id"]

        resp = student_session.patch(
            f"{API}/realms/{_REALM}/users/{user_id}",
            json={"displayName": "Bob Updated"},
            timeout=10,
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["displayName"] == "Bob Updated"

        # Restore original name to avoid state leakage
        student_session.patch(
            f"{API}/realms/{_REALM}/users/{user_id}",
            json={"displayName": "Bob Student"},
            timeout=10,
        )

    def test_senior_admin_can_update_any_user(self, senior_session: requests.Session) -> None:
        list_resp = senior_session.get(f"{API}/realms/{_REALM}/users", timeout=10)
        users = [u for u in list_resp.json()["data"] if u["role"] == "student"]
        assert len(users) > 0
        user_id = users[0]["id"]
        original_name = users[0]["displayName"]

        resp = senior_session.patch(
            f"{API}/realms/{_REALM}/users/{user_id}",
            json={"displayName": "Modified by Senior"},
            timeout=10,
        )
        assert resp.status_code == 200

        # Restore
        senior_session.patch(
            f"{API}/realms/{_REALM}/users/{user_id}",
            json={"displayName": original_name},
            timeout=10,
        )


# ─── Delete user ──────────────────────────────────────────────────────────────

class TestDeleteUser:
    """DELETE /api/realms/:realmId/users/:userId"""

    def test_senior_admin_can_delete_created_user(
        self, senior_session: requests.Session
    ) -> None:
        """Create a throwaway user then delete it."""
        payload = _user_payload()
        create_resp = senior_session.post(
            f"{API}/realms/{_REALM}/users", json=payload, timeout=10
        )
        assert create_resp.status_code == 201
        user_id = create_resp.json()["data"]["id"]

        delete_resp = senior_session.delete(
            f"{API}/realms/{_REALM}/users/{user_id}", timeout=10
        )
        assert delete_resp.status_code in (200, 204)

    def test_student_cannot_delete_user(
        self, student_session: requests.Session, senior_session: requests.Session
    ) -> None:
        list_resp = senior_session.get(f"{API}/realms/{_REALM}/users", timeout=10)
        users = list_resp.json()["data"]
        assert len(users) > 0
        user_id = users[0]["id"]

        resp = student_session.delete(
            f"{API}/realms/{_REALM}/users/{user_id}", timeout=10
        )
        assert resp.status_code == 403
