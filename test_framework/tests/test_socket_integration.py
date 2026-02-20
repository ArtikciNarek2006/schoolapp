"""
test_socket_integration.py — Socket.io integration tests.

Tests:
  1. Connect with valid JWT → receives 'connected' / welcome event.
  2. Connect with invalid token → connection is refused.
  3. Emit SEND_MESSAGE in a joined group room → client receives new_message event.
  4. MARK_READ event is processed without error.
  5. Client auto-joins its realm room on connect.
"""

from __future__ import annotations

import threading
import time
from typing import Any

import pytest
import requests
import socketio as sio

from conftest import (
    API,
    BASE_URL,
    SEEDED_REALM_ID,
    get_token_from_session,
)

pytestmark = pytest.mark.socket

_REALM = SEEDED_REALM_ID

# Maximum seconds to wait for a socket event to arrive
_EVENT_TIMEOUT = 8.0


# ─── helper ───────────────────────────────────────────────────────────────────

class _EventCollector:
    """Thread-safe collector of Socket.io events emitted to the client."""

    def __init__(self) -> None:
        self._events: list[tuple[str, Any]] = []
        self._lock = threading.Lock()
        self._condition = threading.Condition(self._lock)

    def record(self, event: str, data: Any = None) -> None:
        with self._condition:
            self._events.append((event, data))
            self._condition.notify_all()

    def wait_for(self, event_name: str, timeout: float = _EVENT_TIMEOUT) -> Any | None:
        """Block until *event_name* arrives or *timeout* seconds elapse."""
        deadline = time.monotonic() + timeout
        with self._condition:
            while True:
                for name, data in self._events:
                    if name == event_name:
                        return data
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                self._condition.wait(timeout=remaining)

    @property
    def events(self) -> list[tuple[str, Any]]:
        with self._lock:
            return list(self._events)


def _make_client(token: str) -> tuple[sio.Client, _EventCollector]:
    """Return a connected sio.Client with an attached EventCollector."""
    collector = _EventCollector()
    client = sio.Client(logger=False, engineio_logger=False)

    # Register wildcard catch-all — python-socketio supports on('*')
    @client.on("*")
    def _catch_all(event: str, data: Any = None) -> None:
        collector.record(event, data)

    # Also register known events explicitly for reliable delivery
    for ev in ("connect", "disconnect", "welcome", "new_message",
                "group_updated", "notice_published", "lesson_reminder"):
        client.on(ev, lambda data=None, _ev=ev: collector.record(_ev, data))

    client.connect(
        BASE_URL,
        auth={"token": token},
        transports=["websocket"],
        wait=True,
        wait_timeout=10,
    )
    return client, collector


# ─── Connection tests ─────────────────────────────────────────────────────────

class TestSocketConnection:
    """Basic connect / reject behaviour."""

    def test_valid_token_connects_successfully(
        self, student_session: requests.Session
    ) -> None:
        token = get_token_from_session(student_session)
        client, collector = _make_client(token)
        try:
            assert client.connected
        finally:
            client.disconnect()

    def test_invalid_token_is_rejected(self) -> None:
        """A garbage token must cause the server to refuse the connection."""
        client = sio.Client(logger=False, engineio_logger=False)
        with pytest.raises(Exception):
            client.connect(
                BASE_URL,
                auth={"token": "not-a-valid-jwt"},
                transports=["websocket"],
                wait=True,
                wait_timeout=5,
            )

    def test_missing_token_is_rejected(self) -> None:
        """Connecting without auth must be refused."""
        client = sio.Client(logger=False, engineio_logger=False)
        with pytest.raises(Exception):
            client.connect(
                BASE_URL,
                transports=["websocket"],
                wait=True,
                wait_timeout=5,
            )

    def test_welcome_event_received_after_connect(
        self, student_session: requests.Session
    ) -> None:
        token = get_token_from_session(student_session)
        client, collector = _make_client(token)
        try:
            # Allow a short grace period for the welcome payload
            time.sleep(1.5)
            event_names = [name for name, _ in collector.events]
            assert "welcome" in event_names, (
                f"Expected 'welcome' event, got: {event_names}"
            )
        finally:
            client.disconnect()

    def test_senior_admin_token_connects_successfully(
        self, senior_session: requests.Session
    ) -> None:
        token = get_token_from_session(senior_session)
        client, collector = _make_client(token)
        try:
            assert client.connected
        finally:
            client.disconnect()


# ─── Room join / messaging ────────────────────────────────────────────────────

class TestSocketMessaging:
    """
    Send a text message via Socket.io SEND_MESSAGE event and verify the
    sender's client receives the NEW_MESSAGE event back.
    """

    def test_send_message_in_group_returns_ack(
        self,
        student_session: requests.Session,
        general_group_id: str,
    ) -> None:
        """
        Emit SEND_MESSAGE and assert the server acknowledges with success=True.
        The client is auto-enrolled in its group rooms upon connection.
        """
        token = get_token_from_session(student_session)
        client, collector = _make_client(token)
        try:
            # Wait for connection to stabilise
            time.sleep(1.0)
            assert client.connected, "Socket client failed to connect."

            ack: dict | None = None
            ack_received = threading.Event()

            def _on_ack(data: dict) -> None:
                nonlocal ack
                ack = data
                ack_received.set()

            client.emit(
                "send_message",
                {
                    "groupId": general_group_id,
                    "type": "text",
                    "content": "Hello from integration test!",
                },
                callback=_on_ack,
            )

            triggered = ack_received.wait(timeout=_EVENT_TIMEOUT)
            assert triggered, "No acknowledgement received within timeout."
            assert ack is not None
            assert ack.get("success") is True, f"Server ack indicated failure: {ack}"
        finally:
            client.disconnect()

    def test_new_message_event_delivered_to_group_room(
        self,
        student_session: requests.Session,
        senior_session: requests.Session,
        general_group_id: str,
    ) -> None:
        """
        A *listener* client and a *sender* client both connect.
        The sender emits SEND_MESSAGE → the listener must receive new_message.
        """
        sender_token = get_token_from_session(student_session)
        listener_token = get_token_from_session(senior_session)

        # Create two independent clients
        listener_client = sio.Client(logger=False, engineio_logger=False)
        sender_client = sio.Client(logger=False, engineio_logger=False)

        received_events: list[dict] = []
        received_lock = threading.Lock()
        received_condition = threading.Condition(received_lock)

        @listener_client.on("new_message")
        def _on_new_message(data: dict) -> None:
            with received_condition:
                received_events.append(data)
                received_condition.notify_all()

        try:
            listener_client.connect(
                BASE_URL,
                auth={"token": listener_token},
                transports=["websocket"],
                wait=True,
                wait_timeout=10,
            )
            sender_client.connect(
                BASE_URL,
                auth={"token": sender_token},
                transports=["websocket"],
                wait=True,
                wait_timeout=10,
            )

            # Allow both clients to join their group rooms
            time.sleep(1.5)

            unique_content = f"Broadcast test {time.monotonic()}"
            sender_client.emit(
                "send_message",
                {
                    "groupId": general_group_id,
                    "type": "text",
                    "content": unique_content,
                },
            )

            # Wait for the listener to receive it
            deadline = time.monotonic() + _EVENT_TIMEOUT
            with received_condition:
                while not received_events:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        break
                    received_condition.wait(timeout=remaining)

            assert received_events, (
                "Listener did not receive 'new_message' event within timeout."
            )
            msg_data = received_events[-1]
            message = msg_data.get("message", {})
            assert message.get("content") == unique_content
            assert message.get("groupId") == general_group_id
        finally:
            try:
                listener_client.disconnect()
            except Exception:
                pass
            try:
                sender_client.disconnect()
            except Exception:
                pass

    def test_send_message_to_non_member_group_returns_error(
        self,
        student_session: requests.Session,
    ) -> None:
        """Emitting SEND_MESSAGE to a group the user isn't in must return an error ack."""
        import uuid as _uuid
        token = get_token_from_session(student_session)
        client, _ = _make_client(token)
        try:
            time.sleep(1.0)
            ack: dict | None = None
            done = threading.Event()

            def _ack(data: dict) -> None:
                nonlocal ack
                ack = data
                done.set()

            client.emit(
                "send_message",
                {"groupId": str(_uuid.uuid4()), "type": "text", "content": "Sneaky msg"},
                callback=_ack,
            )
            done.wait(timeout=_EVENT_TIMEOUT)
            assert ack is not None, "No ack received."
            assert ack.get("success") is False
        finally:
            client.disconnect()


# ─── Mark read ────────────────────────────────────────────────────────────────

class TestMarkRead:
    """MARK_READ socket event."""

    def test_mark_read_with_valid_group_returns_no_crash(
        self,
        student_session: requests.Session,
        general_group_id: str,
    ) -> None:
        """
        Emitting MARK_READ should either return a success ack or be silently
        ignored — it must not disconnect the client.
        """
        token = get_token_from_session(student_session)
        client, _ = _make_client(token)
        try:
            time.sleep(1.0)
            assert client.connected

            done = threading.Event()
            ack_result: dict | None = None

            def _ack(data: dict | None = None) -> None:
                nonlocal ack_result
                ack_result = data
                done.set()

            client.emit(
                "mark_read",
                {"groupId": general_group_id, "messageId": "fake-msg-id"},
                callback=_ack,
            )
            done.wait(timeout=5.0)
            # Client must still be connected after the event
            time.sleep(0.5)
            assert client.connected
        finally:
            client.disconnect()
