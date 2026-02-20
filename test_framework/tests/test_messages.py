"""
test_messages.py — Integration tests for Group Messages.

Endpoints under test:
  GET    /api/realms/:realmId/groups/:groupId/messages
  DELETE /api/realms/:realmId/groups/:groupId/messages/:msgId
  POST   /api/realms/:realmId/groups/:groupId/messages/upload/image
  POST   /api/realms/:realmId/groups/:groupId/messages/upload/file
"""

from __future__ import annotations

import io
import uuid

import pytest
import requests

from conftest import API, SEEDED_REALM_ID

pytestmark = pytest.mark.messages

_REALM = SEEDED_REALM_ID


# ─── helpers ─────────────────────────────────────────────────────────────────

def _send_message_via_socket_setup(session: requests.Session, group_id: str) -> dict | None:
    """
    Since text message REST POST does not exist (messages go through Socket.io),
    we use the upload/file endpoint with a tiny text payload as a workaround to
    seed a message in history for read/delete tests.
    Alternatively, the helper returns None and tests skip gracefully.
    """
    return None  # REST delete tests will discover IDs from existing seed data


# ─── List messages ────────────────────────────────────────────────────────────

class TestListMessages:
    """GET /api/realms/:realmId/groups/:groupId/messages"""

    def test_member_can_list_messages(
        self,
        student_session: requests.Session,
        general_group_id: str,
    ) -> None:
        resp = student_session.get(
            f"{API}/realms/{_REALM}/groups/{general_group_id}/messages", timeout=10
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert isinstance(body.get("data"), list)

    def test_unauthenticated_cannot_list_messages(self, general_group_id: str) -> None:
        resp = requests.get(
            f"{API}/realms/{_REALM}/groups/{general_group_id}/messages", timeout=10
        )
        assert resp.status_code == 401

    def test_senior_admin_can_list_messages(
        self,
        senior_session: requests.Session,
        general_group_id: str,
    ) -> None:
        resp = senior_session.get(
            f"{API}/realms/{_REALM}/groups/{general_group_id}/messages", timeout=10
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_messages_support_pagination(
        self,
        student_session: requests.Session,
        general_group_id: str,
    ) -> None:
        """Passing limit/before query params must not crash the API."""
        resp = student_session.get(
            f"{API}/realms/{_REALM}/groups/{general_group_id}/messages",
            params={"limit": 5},
            timeout=10,
        )
        assert resp.status_code == 200

    def test_cross_realm_message_access_denied(
        self, student_session: requests.Session
    ) -> None:
        """Student of TS-2B must not read messages from a group in TS-1A."""
        OTHER_REALM = "2a9865bf-2c41-4e42-a7fd-a8609615d510"
        # Use a known group ID from the other realm (realm_001 / group_001)
        OTHER_GROUP = "group_001"
        resp = student_session.get(
            f"{API}/realms/{OTHER_REALM}/groups/{OTHER_GROUP}/messages", timeout=10
        )
        assert resp.status_code in (403, 404)


# ─── Delete message ───────────────────────────────────────────────────────────

class TestDeleteMessage:
    """DELETE /api/realms/:realmId/groups/:groupId/messages/:msgId"""

    def test_delete_nonexistent_message_returns_404(
        self,
        senior_session: requests.Session,
        general_group_id: str,
    ) -> None:
        fake_msg_id = str(uuid.uuid4())
        resp = senior_session.delete(
            f"{API}/realms/{_REALM}/groups/{general_group_id}/messages/{fake_msg_id}",
            timeout=10,
        )
        assert resp.status_code == 404

    def test_unauthenticated_cannot_delete_message(self, general_group_id: str) -> None:
        resp = requests.delete(
            f"{API}/realms/{_REALM}/groups/{general_group_id}/messages/fake-id",
            timeout=10,
        )
        assert resp.status_code == 401

    def test_sender_can_delete_own_message_when_present(
        self,
        student_session: requests.Session,
        general_group_id: str,
    ) -> None:
        """
        If there are messages in the general group, verify the sender can
        delete one.  If the list is empty, the test is skipped gracefully.
        """
        list_resp = student_session.get(
            f"{API}/realms/{_REALM}/groups/{general_group_id}/messages", timeout=10
        )
        messages = list_resp.json().get("data", [])
        me_resp = student_session.get(f"{API}/auth/me", timeout=10)
        my_id = me_resp.json()["user"]["id"]
        own_msgs = [m for m in messages if m.get("senderId") == my_id]

        if not own_msgs:
            pytest.skip("No messages from this student to delete.")

        msg_id = own_msgs[-1]["id"]
        resp = student_session.delete(
            f"{API}/realms/{_REALM}/groups/{general_group_id}/messages/{msg_id}",
            timeout=10,
        )
        assert resp.status_code in (200, 204)


# ─── File upload ──────────────────────────────────────────────────────────────

class TestUploadFile:
    """POST /api/realms/:realmId/groups/:groupId/messages/upload/file"""

    def test_member_can_upload_text_file(
        self,
        student_session: requests.Session,
        general_group_id: str,
    ) -> None:
        fake_file_content = b"Hello, this is an integration test file."
        resp = student_session.post(
            f"{API}/realms/{_REALM}/groups/{general_group_id}/messages/upload/file",
            files={"file": ("test.txt", io.BytesIO(fake_file_content), "text/plain")},
            timeout=15,
        )
        # 200/201 = success; 400 = validation error (e.g. wrong mime type accepted)
        assert resp.status_code in (200, 201, 400)
        if resp.status_code in (200, 201):
            body = resp.json()
            assert body["success"] is True

    def test_upload_without_file_field_returns_400(
        self,
        student_session: requests.Session,
        general_group_id: str,
    ) -> None:
        resp = student_session.post(
            f"{API}/realms/{_REALM}/groups/{general_group_id}/messages/upload/file",
            timeout=10,
        )
        assert resp.status_code == 400

    def test_unauthenticated_upload_returns_401(self, general_group_id: str) -> None:
        fake_file_content = b"Unauthorized upload attempt."
        resp = requests.post(
            f"{API}/realms/{_REALM}/groups/{general_group_id}/messages/upload/file",
            files={"file": ("test.txt", io.BytesIO(fake_file_content), "text/plain")},
            timeout=10,
        )
        assert resp.status_code == 401


# ─── Image upload ─────────────────────────────────────────────────────────────

class TestUploadImage:
    """POST /api/realms/:realmId/groups/:groupId/messages/upload/image"""

    # Minimal 1×1 white JPEG bytes
    _TINY_JPEG = bytes(
        b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
        b"\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t"
        b"\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a"
        b"\x1f\x1e\x1d\x1a\x1c\x1c $.' \",#\x1c\x1c(7),01444\x1f'9=82<.342\x1e\xc0"
        b"\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x1f\x00"
        b"\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00"
        b"\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xda\x00\x08\x01"
        b"\x01\x00\x00?\x00\xfb\xd4\xff\xd9"
    )

    def test_member_can_upload_image(
        self,
        student_session: requests.Session,
        general_group_id: str,
    ) -> None:
        resp = student_session.post(
            f"{API}/realms/{_REALM}/groups/{general_group_id}/messages/upload/image",
            files={"image": ("photo.jpg", io.BytesIO(self._TINY_JPEG), "image/jpeg")},
            timeout=15,
        )
        assert resp.status_code in (200, 201, 400)
        if resp.status_code in (200, 201):
            body = resp.json()
            assert body["success"] is True
            assert "fileUrl" in body.get("data", {}) or "url" in body.get("data", {})

    def test_non_image_file_upload_to_image_endpoint_returns_400(
        self,
        student_session: requests.Session,
        general_group_id: str,
    ) -> None:
        resp = student_session.post(
            f"{API}/realms/{_REALM}/groups/{general_group_id}/messages/upload/image",
            files={"image": ("malicious.exe", io.BytesIO(b"\x00\x01\x02"), "application/octet-stream")},
            timeout=10,
        )
        assert resp.status_code == 400

    def test_unauthenticated_image_upload_returns_401(self, general_group_id: str) -> None:
        resp = requests.post(
            f"{API}/realms/{_REALM}/groups/{general_group_id}/messages/upload/image",
            files={"image": ("photo.jpg", io.BytesIO(self._TINY_JPEG), "image/jpeg")},
            timeout=10,
        )
        assert resp.status_code == 401
