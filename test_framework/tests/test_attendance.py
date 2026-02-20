"""
test_attendance.py — Integration tests for Attendance endpoints.

Endpoints under test:
  POST /api/realms/:realmId/attendance/checkin
  GET  /api/realms/:realmId/attendance/me
  GET  /api/realms/:realmId/attendance/analytics/me
  GET  /api/realms/:realmId/attendance/analytics/:userId
  GET  /api/realms/:realmId/attendance/today
  GET  /api/realms/:realmId/attendance
"""

from __future__ import annotations

import pytest
import requests

from conftest import API, SEEDED_REALM_ID

pytestmark = pytest.mark.attendance

_REALM = SEEDED_REALM_ID


# ─── Student self-service check-in ───────────────────────────────────────────

class TestCheckIn:
    """POST /api/realms/:realmId/attendance/checkin"""

    def test_student_can_attempt_checkin(self, student_session: requests.Session) -> None:
        """
        The check-in endpoint is always reachable.  When no lesson window is
        open the API returns a failure message rather than a 5xx error.
        We accept 200 (checked in), 400/409 (window closed / already checked in).
        """
        resp = student_session.post(
            f"{API}/realms/{_REALM}/attendance/checkin",
            json={},
            timeout=10,
        )
        assert resp.status_code in (200, 201, 400, 409)
        assert resp.json().get("success") is not None

    def test_senior_admin_cannot_checkin_as_student(
        self, senior_session: requests.Session
    ) -> None:
        """Senior admin role does not trigger a student check-in action."""
        resp = senior_session.post(
            f"{API}/realms/{_REALM}/attendance/checkin",
            json={},
            timeout=10,
        )
        # Could return 403 (role mismatch) or 400 (no open window)
        assert resp.status_code in (400, 403, 409)

    def test_unauthenticated_checkin_returns_401(self) -> None:
        resp = requests.post(
            f"{API}/realms/{_REALM}/attendance/checkin", json={}, timeout=10
        )
        assert resp.status_code == 401


# ─── Student's own attendance history ────────────────────────────────────────

class TestMyAttendance:
    """GET /api/realms/:realmId/attendance/me"""

    def test_student_can_get_own_attendance(self, student_session: requests.Session) -> None:
        resp = student_session.get(f"{API}/realms/{_REALM}/attendance/me", timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert isinstance(body.get("data"), list)

    def test_unauthenticated_cannot_get_own_attendance(self) -> None:
        resp = requests.get(f"{API}/realms/{_REALM}/attendance/me", timeout=10)
        assert resp.status_code == 401


# ─── Analytics: own ───────────────────────────────────────────────────────────

class TestMyAnalytics:
    """GET /api/realms/:realmId/attendance/analytics/me"""

    def test_student_can_get_own_analytics(self, student_session: requests.Session) -> None:
        resp = student_session.get(
            f"{API}/realms/{_REALM}/attendance/analytics/me", timeout=10
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert "data" in body

    def test_senior_admin_can_get_own_analytics(
        self, senior_session: requests.Session
    ) -> None:
        resp = senior_session.get(
            f"{API}/realms/{_REALM}/attendance/analytics/me", timeout=10
        )
        assert resp.status_code == 200


# ─── Analytics: specific user (senior only) ───────────────────────────────────

class TestUserAnalytics:
    """GET /api/realms/:realmId/attendance/analytics/:userId"""

    def test_senior_admin_can_get_student_analytics(
        self, senior_session: requests.Session
    ) -> None:
        list_resp = senior_session.get(f"{API}/realms/{_REALM}/users", timeout=10)
        students = [u for u in list_resp.json()["data"] if u["role"] == "student"]
        if not students:
            pytest.skip("No students found in seeded realm.")
        user_id = students[0]["id"]
        resp = senior_session.get(
            f"{API}/realms/{_REALM}/attendance/analytics/{user_id}", timeout=10
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_student_cannot_get_other_student_analytics(
        self, student_session: requests.Session, senior_session: requests.Session
    ) -> None:
        """Students must not access other users' analytics."""
        me_resp = student_session.get(f"{API}/auth/me", timeout=10)
        my_id = me_resp.json()["user"]["id"]

        list_resp = senior_session.get(f"{API}/realms/{_REALM}/users", timeout=10)
        others = [u for u in list_resp.json()["data"] if u["id"] != my_id]
        if not others:
            pytest.skip("No other users in realm to test with.")

        resp = student_session.get(
            f"{API}/realms/{_REALM}/attendance/analytics/{others[0]['id']}",
            timeout=10,
        )
        assert resp.status_code == 403


# ─── Today's register (senior admin) ─────────────────────────────────────────

class TestTodayRegister:
    """GET /api/realms/:realmId/attendance/today"""

    def test_senior_admin_can_get_today_register(
        self, senior_session: requests.Session
    ) -> None:
        resp = senior_session.get(
            f"{API}/realms/{_REALM}/attendance/today", timeout=10
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_student_cannot_get_today_register(self, student_session: requests.Session) -> None:
        resp = student_session.get(
            f"{API}/realms/{_REALM}/attendance/today", timeout=10
        )
        assert resp.status_code == 403


# ─── Full attendance list (senior admin) ──────────────────────────────────────

class TestListAttendance:
    """GET /api/realms/:realmId/attendance"""

    def test_senior_admin_can_list_attendance(self, senior_session: requests.Session) -> None:
        resp = senior_session.get(f"{API}/realms/{_REALM}/attendance", timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert isinstance(body.get("data"), list)

    def test_attendance_list_supports_date_filter(
        self, senior_session: requests.Session
    ) -> None:
        resp = senior_session.get(
            f"{API}/realms/{_REALM}/attendance",
            params={"date": "2026-02-20"},
            timeout=10,
        )
        assert resp.status_code == 200

    def test_student_cannot_list_all_attendance(
        self, student_session: requests.Session
    ) -> None:
        resp = student_session.get(f"{API}/realms/{_REALM}/attendance", timeout=10)
        assert resp.status_code == 403
