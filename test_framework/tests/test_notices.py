"""
test_notices.py — Integration tests for the Notices endpoints.

Endpoints under test:
  GET    /api/realms/:realmId/notices
  GET    /api/realms/:realmId/notices/:noticeId
  POST   /api/realms/:realmId/notices
  PATCH  /api/realms/:realmId/notices/:noticeId
  DELETE /api/realms/:realmId/notices/:noticeId
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

from conftest import API, SEEDED_REALM_ID

pytestmark = pytest.mark.notices  # custom marker (informational only)

_REALM = SEEDED_REALM_ID


def _notice_payload() -> dict:
    now = datetime.now(timezone.utc)
    return {
        "title": f"Test Notice {uuid.uuid4().hex[:6]}",
        "body": "This is an auto-generated integration test notice.",
        "publishAt": now.isoformat(),
        "expiresAt": (now + timedelta(days=7)).isoformat(),
    }


# ─── List notices ─────────────────────────────────────────────────────────────

class TestListNotices:
    """GET /api/realms/:realmId/notices"""

    def test_student_can_list_notices(self, student_session: requests.Session) -> None:
        resp = student_session.get(f"{API}/realms/{_REALM}/notices", timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert isinstance(body.get("data"), list)

    def test_senior_admin_can_list_notices(self, senior_session: requests.Session) -> None:
        resp = senior_session.get(f"{API}/realms/{_REALM}/notices", timeout=10)
        assert resp.status_code == 200

    def test_unauthenticated_cannot_list_notices(self) -> None:
        resp = requests.get(f"{API}/realms/{_REALM}/notices", timeout=10)
        assert resp.status_code == 401

    def test_cross_realm_notice_access_denied(self, student_session: requests.Session) -> None:
        OTHER_REALM = "2a9865bf-2c41-4e42-a7fd-a8609615d510"
        resp = student_session.get(f"{API}/realms/{OTHER_REALM}/notices", timeout=10)
        assert resp.status_code in (403, 404)


# ─── Get single notice ────────────────────────────────────────────────────────

class TestGetNotice:
    """GET /api/realms/:realmId/notices/:noticeId"""

    def test_get_nonexistent_notice_returns_404(self, student_session: requests.Session) -> None:
        fake_id = str(uuid.uuid4())
        resp = student_session.get(f"{API}/realms/{_REALM}/notices/{fake_id}", timeout=10)
        assert resp.status_code == 404

    def test_senior_admin_can_get_notice(self, senior_session: requests.Session) -> None:
        # Create a notice first
        create_resp = senior_session.post(
            f"{API}/realms/{_REALM}/notices",
            json=_notice_payload(),
            timeout=10,
        )
        assert create_resp.status_code == 201
        notice_id = create_resp.json()["data"]["id"]

        resp = senior_session.get(
            f"{API}/realms/{_REALM}/notices/{notice_id}", timeout=10
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["id"] == notice_id


# ─── Create notice ────────────────────────────────────────────────────────────

class TestCreateNotice:
    """POST /api/realms/:realmId/notices"""

    def test_senior_admin_can_create_notice(self, senior_session: requests.Session) -> None:
        payload = _notice_payload()
        resp = senior_session.post(f"{API}/realms/{_REALM}/notices", json=payload, timeout=10)
        assert resp.status_code == 201
        body = resp.json()
        assert body["success"] is True
        assert body["data"]["title"] == payload["title"]

    def test_student_cannot_create_notice(self, student_session: requests.Session) -> None:
        resp = student_session.post(
            f"{API}/realms/{_REALM}/notices", json=_notice_payload(), timeout=10
        )
        assert resp.status_code == 403

    def test_create_notice_missing_title_returns_400(
        self, senior_session: requests.Session
    ) -> None:
        payload = _notice_payload()
        del payload["title"]
        resp = senior_session.post(f"{API}/realms/{_REALM}/notices", json=payload, timeout=10)
        assert resp.status_code == 400

    def test_create_notice_missing_body_returns_400(
        self, senior_session: requests.Session
    ) -> None:
        payload = _notice_payload()
        del payload["body"]
        resp = senior_session.post(f"{API}/realms/{_REALM}/notices", json=payload, timeout=10)
        assert resp.status_code == 400


# ─── Update notice ────────────────────────────────────────────────────────────

class TestUpdateNotice:
    """PATCH /api/realms/:realmId/notices/:noticeId"""

    def test_senior_admin_can_update_notice(self, senior_session: requests.Session) -> None:
        create_resp = senior_session.post(
            f"{API}/realms/{_REALM}/notices",
            json=_notice_payload(),
            timeout=10,
        )
        assert create_resp.status_code == 201
        notice_id = create_resp.json()["data"]["id"]

        resp = senior_session.patch(
            f"{API}/realms/{_REALM}/notices/{notice_id}",
            json={"title": "Updated Title"},
            timeout=10,
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["title"] == "Updated Title"

    def test_student_cannot_update_notice(
        self, student_session: requests.Session, senior_session: requests.Session
    ) -> None:
        create_resp = senior_session.post(
            f"{API}/realms/{_REALM}/notices",
            json=_notice_payload(),
            timeout=10,
        )
        assert create_resp.status_code == 201
        notice_id = create_resp.json()["data"]["id"]

        resp = student_session.patch(
            f"{API}/realms/{_REALM}/notices/{notice_id}",
            json={"title": "Hacked"},
            timeout=10,
        )
        assert resp.status_code == 403

    def test_update_nonexistent_notice_returns_404(
        self, senior_session: requests.Session
    ) -> None:
        fake_id = str(uuid.uuid4())
        resp = senior_session.patch(
            f"{API}/realms/{_REALM}/notices/{fake_id}",
            json={"title": "Ghost"},
            timeout=10,
        )
        assert resp.status_code == 404


# ─── Delete notice ────────────────────────────────────────────────────────────

class TestDeleteNotice:
    """DELETE /api/realms/:realmId/notices/:noticeId"""

    def test_senior_admin_can_delete_notice(self, senior_session: requests.Session) -> None:
        create_resp = senior_session.post(
            f"{API}/realms/{_REALM}/notices",
            json=_notice_payload(),
            timeout=10,
        )
        assert create_resp.status_code == 201
        notice_id = create_resp.json()["data"]["id"]

        resp = senior_session.delete(
            f"{API}/realms/{_REALM}/notices/{notice_id}", timeout=10
        )
        assert resp.status_code in (200, 204)

    def test_student_cannot_delete_notice(
        self, student_session: requests.Session, senior_session: requests.Session
    ) -> None:
        create_resp = senior_session.post(
            f"{API}/realms/{_REALM}/notices",
            json=_notice_payload(),
            timeout=10,
        )
        assert create_resp.status_code == 201
        notice_id = create_resp.json()["data"]["id"]

        resp = student_session.delete(
            f"{API}/realms/{_REALM}/notices/{notice_id}", timeout=10
        )
        assert resp.status_code == 403

    def test_delete_nonexistent_notice_returns_404(
        self, senior_session: requests.Session
    ) -> None:
        fake_id = str(uuid.uuid4())
        resp = senior_session.delete(
            f"{API}/realms/{_REALM}/notices/{fake_id}", timeout=10
        )
        assert resp.status_code == 404
