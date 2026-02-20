/**
 * socket.js  —  Socket.io client manager
 *
 * Usage:
 *   SocketManager.connect(token)
 *   SocketManager.on('new_message', handler)
 *   SocketManager.off('new_message', handler)
 *   SocketManager.emit('send_message', payload, ack)
 *   SocketManager.disconnect()
 */
'use strict';

const SocketManager = (() => {
  let _socket = null;
  const _handlers = {}; // event → Set<fn>

  function connect(token) {
    if (_socket?.connected) return _socket;

    _socket = io({ auth: { token }, reconnectionAttempts: 10, reconnectionDelay: 2000 });

    _socket.on('connect', () => {
      console.log('[socket] connected:', _socket.id);
      _dispatch('_connected', {});
    });

    _socket.on('disconnect', (reason) => {
      console.log('[socket] disconnected:', reason);
      _dispatch('_disconnected', { reason });
    });

    _socket.on('connect_error', (err) => {
      console.warn('[socket] connect_error:', err.message);
      _dispatch('_error', { message: err.message });
    });

    // Forward all server events to local handlers
    const SERVER_EVENTS = [
      'welcome',
      'new_message',
      'message_deleted',
      'read_receipt',
      'typing',
      'stop_typing',
      'notice_published',
      'lesson_reminder',
      'group_updated',
      'user_joined_group',
      'user_left_group',
    ];
    for (const ev of SERVER_EVENTS) {
      _socket.on(ev, (data) => _dispatch(ev, data));
    }

    return _socket;
  }

  function disconnect() {
    _socket?.disconnect();
    _socket = null;
  }

  function emit(event, payload, ack) {
    if (!_socket?.connected) {
      console.warn('[socket] emit called while disconnected', event);
      return Promise.resolve({ success: false, message: 'Not connected' });
    }
    if (ack) {
      _socket.emit(event, payload, ack);
    } else {
      return new Promise((resolve) => _socket.emit(event, payload, resolve));
    }
  }

  function on(event, fn) {
    if (!_handlers[event]) _handlers[event] = new Set();
    _handlers[event].add(fn);
  }

  function off(event, fn) {
    _handlers[event]?.delete(fn);
  }

  function _dispatch(event, data) {
    (_handlers[event] || new Set()).forEach((fn) => {
      try { fn(data); } catch (e) { console.error('[socket handler error]', event, e); }
    });
  }

  function isConnected() { return _socket?.connected ?? false; }

  return { connect, disconnect, emit, on, off, isConnected };
})();

window.SocketManager = SocketManager;
