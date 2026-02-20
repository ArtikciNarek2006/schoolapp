"""
test_timetable.py — Integration tests for the Timetable endpoints.

Endpoints under test:
  GET    /api/realms/:realmId/timetable
  GET    /api/realms/:realmId/timetable/today
  PUT    /api/realms/:realmId/timetable
  POST   /api/realms/:realmId/timetable/:weekType/:day
  PATCH  /api/realms/:realmId/timetable/:weekType/:day/:periodId
  DELETE /api/realms/:realmId/timetable/:weekType/:day/:periodId
"""

from __future__ import annotations

import pytest
import requests

from conftest import API, SEEDED_REALM_ID

pytestmark = pytest.mark.timetable

_REALM = SEEDED_REALM_ID

# A minimal timetable structure used for PUT (full upsert)
_FULL_TIMETABLE: dict = {
    "odd": {
        "monday": [
            {
                "subject": "Mathematics",
                "teacher": "Mr. Smith",
                "startTime": "09:00",
                "endTime": "10:00",
                "room": "101",
            }
        ]
    },
    "even": {
        "tuesday": [
            {
                "subject": "Physics",
                "teacher": "Ms. Jones",
                "startTime": "11:00",
                "endTime": "12:00",
                "room": "Lab-A",
            }
        ]
    },
}

_NEW_PERIOD: dict = {
    "subject": "History",
    "teacher": "Mrs. Brown",
    "startTime": "14:00",
    "endTime": "15:00",
    "room": "202",
}


# ─── Get timetable ────────────────────────────────────────────────────────────

class TestGetTimetable:
    """GET /api/realms/:realmId/timetable"""

    def test_senior_admin_can_get_timetable(self, senior_session: requests.Session) -> None:
        resp = senior_session.get(f"{API}/realms/{_REALM}/timetable", timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert "data" in body

    def test_student_can_get_timetable(self, student_session: requests.Session) -> None:
        """All realm members may view the timetable."""
        resp = student_session.get(f"{API}/realms/{_REALM}/timetable", timeout=10)
        assert resp.status_code == 200

    def test_unauthenticated_cannot_get_timetable(self) -> None:
        resp = requests.get(f"{API}/realms/{_REALM}/timetable", timeout=10)
        assert resp.status_code == 401


# ─── Get today's schedule ─────────────────────────────────────────────────────

class TestGetTodaySchedule:
    """GET /api/realms/:realmId/timetable/today"""

    def test_student_can_get_today_schedule(self, student_session: requests.Session) -> None:
        resp = student_session.get(f"{API}/realms/{_REALM}/timetable/today", timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True

    def test_senior_admin_can_get_today_schedule(
        self, senior_session: requests.Session
    ) -> None:
        resp = senior_session.get(f"{API}/realms/{_REALM}/timetable/today", timeout=10)
        assert resp.status_code == 200


# ─── Upsert (full replace) ────────────────────────────────────────────────────

class TestUpsertTimetable:
    """PUT /api/realms/:realmId/timetable"""

    def test_senior_admin_can_upsert_timetable(
        self, senior_session: requests.Session
    ) -> None:
        resp = senior_session.put(
            f"{API}/realms/{_REALM}/timetable",
            json=_FULL_TIMETABLE,
            timeout=10,
        )
        assert resp.status_code in (200, 201)
        assert resp.json()["success"] is True

    def test_student_cannot_upsert_timetable(self, student_session: requests.Session) -> None:
        resp = student_session.put(
            f"{API}/realms/{_REALM}/timetable",
            json=_FULL_TIMETABLE,
            timeout=10,
        )
        assert resp.status_code == 403

    def test_unauthenticated_cannot_upsert_timetable(self) -> None:
        resp = requests.put(
            f"{API}/realms/{_REALM}/timetable",
            json=_FULL_TIMETABLE,
            timeout=10,
        )
        assert resp.status_code == 401


# ─── Add period ───────────────────────────────────────────────────────────────

class TestAddPeriod:
    """POST /api/realms/:realmId/timetable/:weekType/:day"""

    def test_senior_admin_can_add_period(self, senior_session: requests.Session) -> None:
        resp = senior_session.post(
            f"{API}/realms/{_REALM}/timetable/odd/wednesday",
            json=_NEW_PERIOD,
            timeout=10,
        )
        assert resp.status_code in (200, 201)
        body = resp.json()
        assert body["success"] is True

    def test_student_cannot_add_period(self, student_session: requests.Session) -> None:
        resp = student_session.post(
            f"{API}/realms/{_REALM}/timetable/odd/wednesday",
            json=_NEW_PERIOD,
            timeout=10,
        )
        assert resp.status_code == 403


# ─── Update / Delete period ───────────────────────────────────────────────────

class TestUpdateDeletePeriod:
    """PATCH & DELETE /api/realms/:realmId/timetable/:weekType/:day/:periodId"""

    @pytest.fixture(autouse=True)
    def _ensure_period_exists(self, senior_session: requests.Session) -> None:
        """Ensure at least one period under odd/monday exists before patch/delete tests."""
        senior_session.post(
            f"{API}/realms/{_REALM}/timetable/odd/monday",
            json=_NEW_PERIOD,
            timeout=10,
        )

    def _get_first_period_id(self, senior_session: requests.Session) -> str | None:
        resp = senior_session.get(f"{API}/realms/{_REALM}/timetable", timeout=10)
        data = resp.json().get("data", {})
        periods = data.get("odd", {}).get("monday", [])
        return periods[0].get("id") if periods else None

    def test_senior_admin_can_update_period(self, senior_session: requests.Session) -> None:
        period_id = self._get_first_period_id(senior_session)
        if not period_id:
            pytest.skip("No period available to update.")
        resp = senior_session.patch(
            f"{API}/realms/{_REALM}/timetable/odd/monday/{period_id}",
            json={"subject": "Advanced Maths"},
            timeout=10,
        )
        assert resp.status_code == 200

    def test_senior_admin_can_delete_period(self, senior_session: requests.Session) -> None:
        period_id = self._get_first_period_id(senior_session)
        if not period_id:
            pytest.skip("No period available to delete.")
        resp = senior_session.delete(
            f"{API}/realms/{_REALM}/timetable/odd/monday/{period_id}",
            timeout=10,
        )
        assert resp.status_code in (200, 204)

    def test_student_cannot_delete_period(self, student_session: requests.Session) -> None:
        resp = student_session.delete(
            f"{API}/realms/{_REALM}/timetable/odd/monday/fake-period-id",
            timeout=10,
        )
        assert resp.status_code == 403
