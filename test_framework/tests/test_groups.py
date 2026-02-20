"""
test_groups.py — Integration tests for Group management.

Endpoints under test:
  GET    /api/realms/:realmId/groups
  POST   /api/realms/:realmId/groups
  GET    /api/realms/:realmId/groups/:groupId
  PATCH  /api/realms/:realmId/groups/:groupId
  DELETE /api/realms/:realmId/groups/:groupId
  POST   /api/realms/:realmId/groups/:groupId/join
  POST   /api/realms/:realmId/groups/:groupId/leave
  POST   /api/realms/:realmId/groups/:groupId/members
  DELETE /api/realms/:realmId/groups/:groupId/members/:userId
"""

from __future__ import annotations

import uuid

import pytest
import requests

from conftest import API, SEEDED_REALM_ID

pytestmark = pytest.mark.groups

_REALM = SEEDED_REALM_ID


def _group_payload(type_: str = "voluntary") -> dict:
    return {
        "name": f"Test Group {uuid.uuid4().hex[:6]}",
        "description": "Created by integration test suite.",
        "type": type_,
    }


# ─── List groups ──────────────────────────────────────────────────────────────

class TestListGroups:
    """GET /api/realms/:realmId/groups"""

    def test_student_can_list_their_groups(self, student_session: requests.Session) -> None:
        resp = student_session.get(f"{API}/realms/{_REALM}/groups", timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert isinstance(body["data"], list)

    def test_senior_admin_can_list_all_groups(self, senior_session: requests.Session) -> None:
        resp = senior_session.get(
            f"{API}/realms/{_REALM}/groups", params={"all": "true"}, timeout=10
        )
        assert resp.status_code == 200
        # General group must always be present
        groups = resp.json()["data"]
        types = [g["type"] for g in groups]
        assert "general" in types

    def test_unauthenticated_cannot_list_groups(self) -> None:
        resp = requests.get(f"{API}/realms/{_REALM}/groups", timeout=10)
        assert resp.status_code == 401


# ─── Get single group ─────────────────────────────────────────────────────────

class TestGetGroup:
    """GET /api/realms/:realmId/groups/:groupId"""

    def test_member_can_get_group_detail(
        self, student_session: requests.Session, general_group_id: str
    ) -> None:
        resp = student_session.get(
            f"{API}/realms/{_REALM}/groups/{general_group_id}", timeout=10
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["data"]["id"] == general_group_id
        assert isinstance(body["data"]["members"], list)

    def test_get_nonexistent_group_returns_404(
        self, senior_session: requests.Session
    ) -> None:
        fake_id = str(uuid.uuid4())
        resp = senior_session.get(
            f"{API}/realms/{_REALM}/groups/{fake_id}", timeout=10
        )
        assert resp.status_code == 404


# ─── Create group ─────────────────────────────────────────────────────────────

class TestCreateGroup:
    """POST /api/realms/:realmId/groups"""

    def test_student_can_create_voluntary_group(
        self, student_session: requests.Session
    ) -> None:
        payload = _group_payload("voluntary")
        resp = student_session.post(f"{API}/realms/{_REALM}/groups", json=payload, timeout=10)
        assert resp.status_code == 201
        body = resp.json()
        assert body["success"] is True
        assert body["data"]["type"] == "voluntary"

    def test_senior_admin_can_create_mandatory_group(
        self, senior_session: requests.Session
    ) -> None:
        payload = _group_payload("mandatory")
        resp = senior_session.post(f"{API}/realms/{_REALM}/groups", json=payload, timeout=10)
        assert resp.status_code == 201
        assert resp.json()["data"]["type"] == "mandatory"

    def test_student_cannot_create_mandatory_group(
        self, student_session: requests.Session
    ) -> None:
        payload = _group_payload("mandatory")
        resp = student_session.post(f"{API}/realms/{_REALM}/groups", json=payload, timeout=10)
        assert resp.status_code == 403

    def test_creating_general_group_directly_is_forbidden(
        self, senior_session: requests.Session
    ) -> None:
        payload = _group_payload("general")
        resp = senior_session.post(f"{API}/realms/{_REALM}/groups", json=payload, timeout=10)
        assert resp.status_code == 403

    def test_create_group_missing_name_returns_400(
        self, student_session: requests.Session
    ) -> None:
        resp = student_session.post(
            f"{API}/realms/{_REALM}/groups",
            json={"description": "No name", "type": "voluntary"},
            timeout=10,
        )
        assert resp.status_code == 400


# ─── Update group ─────────────────────────────────────────────────────────────

class TestUpdateGroup:
    """PATCH /api/realms/:realmId/groups/:groupId"""

    def test_group_admin_can_update_description(
        self, student_session: requests.Session
    ) -> None:
        # Student creates their own voluntary group
        create_resp = student_session.post(
            f"{API}/realms/{_REALM}/groups",
            json=_group_payload("voluntary"),
            timeout=10,
        )
        assert create_resp.status_code == 201
        group_id = create_resp.json()["data"]["id"]

        resp = student_session.patch(
            f"{API}/realms/{_REALM}/groups/{group_id}",
            json={"description": "Updated description"},
            timeout=10,
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["description"] == "Updated description"


# ─── Join / Leave ─────────────────────────────────────────────────────────────

class TestJoinLeaveGroup:
    """POST /api/realms/:realmId/groups/:groupId/join|leave"""

    @pytest.fixture()
    def voluntary_group_id(self, senior_session: requests.Session) -> str:
        """Create a voluntary group that students can join."""
        payload = _group_payload("voluntary")
        resp = senior_session.post(f"{API}/realms/{_REALM}/groups", json=payload, timeout=10)
        assert resp.status_code == 201
        return resp.json()["data"]["id"]

    def test_student_can_join_voluntary_group(
        self, student_session: requests.Session, voluntary_group_id: str
    ) -> None:
        resp = student_session.post(
            f"{API}/realms/{_REALM}/groups/{voluntary_group_id}/join", timeout=10
        )
        # 200 (joined) or 409 (already a member) are both acceptable
        assert resp.status_code in (200, 409)

    def test_student_can_leave_voluntary_group(
        self, student_session: requests.Session, voluntary_group_id: str
    ) -> None:
        # Ensure membership first
        student_session.post(
            f"{API}/realms/{_REALM}/groups/{voluntary_group_id}/join", timeout=10
        )
        resp = student_session.post(
            f"{API}/realms/{_REALM}/groups/{voluntary_group_id}/leave", timeout=10
        )
        assert resp.status_code in (200, 400)  # 400 if not a member


# ─── Membership management (senior admin) ────────────────────────────────────

class TestMembershipManagement:
    """POST|DELETE /api/realms/:realmId/groups/:groupId/members[/:userId]"""

    def test_senior_admin_can_add_member(
        self,
        senior_session: requests.Session,
        student_session: requests.Session,
    ) -> None:
        # Create a group
        group_resp = senior_session.post(
            f"{API}/realms/{_REALM}/groups", json=_group_payload("mandatory"), timeout=10
        )
        assert group_resp.status_code == 201
        group_id = group_resp.json()["data"]["id"]

        # Discover student's ID
        me_resp = student_session.get(f"{API}/auth/me", timeout=10)
        student_id = me_resp.json()["user"]["id"]

        resp = senior_session.post(
            f"{API}/realms/{_REALM}/groups/{group_id}/members",
            json={"userIds": [student_id]},
            timeout=10,
        )
        assert resp.status_code in (200, 201)

    def test_student_cannot_add_members(
        self,
        student_session: requests.Session,
        senior_session: requests.Session,
    ) -> None:
        group_resp = senior_session.post(
            f"{API}/realms/{_REALM}/groups", json=_group_payload("mandatory"), timeout=10
        )
        group_id = group_resp.json()["data"]["id"]

        resp = student_session.post(
            f"{API}/realms/{_REALM}/groups/{group_id}/members",
            json={"userIds": ["fake-user-id"]},
            timeout=10,
        )
        assert resp.status_code == 403


# ─── Archive group ────────────────────────────────────────────────────────────

class TestArchiveGroup:
    """DELETE /api/realms/:realmId/groups/:groupId"""

    def test_senior_admin_can_archive_group(self, senior_session: requests.Session) -> None:
        group_resp = senior_session.post(
            f"{API}/realms/{_REALM}/groups", json=_group_payload("mandatory"), timeout=10
        )
        assert group_resp.status_code == 201
        group_id = group_resp.json()["data"]["id"]

        resp = senior_session.delete(
            f"{API}/realms/{_REALM}/groups/{group_id}", timeout=10
        )
        assert resp.status_code in (200, 204)

    def test_student_cannot_archive_group(
        self, student_session: requests.Session, general_group_id: str
    ) -> None:
        resp = student_session.delete(
            f"{API}/realms/{_REALM}/groups/{general_group_id}", timeout=10
        )
        assert resp.status_code == 403
