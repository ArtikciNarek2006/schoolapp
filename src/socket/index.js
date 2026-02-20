/**
 * src/socket/index.js  —  Socket.io connection handler
 *
 * Responsibilities (Phase 3 scope):
 *   • Authenticate every connecting socket via JWT (handshake auth or cookie).
 *   • Join the socket to its realm room (used by the notification scheduler
 *     and, in Phase 4, by the chat system).
 *   • Join per-group rooms the user is a member of.
 *   • Emit a welcome payload so the client knows its identity.
 *
 * Chat-specific events (send_message, join_room, typing…) are wired in Phase 4
 * by importing and calling the chat handler from this file.
 */

'use strict';

const jwt = require('jsonwebtoken');
const db  = require('../db/jsonDb');
const { SOCKET_EVENTS } = require('../../config/constants');

/**
 * Called once in server.js: socketHandler(io)
 * @param {import('socket.io').Server} io
 */
function socketHandler(io) {

  // ── Authentication middleware (runs before the 'connection' event) ──────────
  io.use((socket, next) => {
    try {
      // Accept token from handshake auth object OR from cookie header
      let token = socket.handshake.auth?.token;

      if (!token) {
        // Parse cookies if present
        const cookieHeader = socket.handshake.headers?.cookie || '';
        const cookies = Object.fromEntries(
          cookieHeader.split(';').map((c) => c.trim().split('=').map(decodeURIComponent)).filter(([k]) => k)
        );
        token = cookies.token;
      }

      if (!token) return next(new Error('Authentication required.'));

      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const user    = db.findOne('users', (u) => u.id === payload.sub);

      if (!user || !user.isActive) return next(new Error('User not found or deactivated.'));

      // Attach safe user (no hash) to socket
      const { passwordHash, ...safeUser } = user;
      socket.user = safeUser;
      next();
    } catch {
      next(new Error('Invalid or expired token.'));
    }
  });

  // ── Connection ──────────────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    const user = socket.user;
    console.log(`[socket] connected: ${user.displayName} (${user.role}) | socketId: ${socket.id}`);

    // ── Join realm room ───────────────────────────────────────────────────────
    if (user.realmId) {
      socket.join(user.realmId);
      console.log(`[socket] ${user.displayName} joined realm room: ${user.realmId}`);
    }

    // ── Join all group rooms this user is a member of ─────────────────────────
    if (user.realmId) {
      const groups = db.findAll('groups',
        (g) => g.realmId === user.realmId && g.memberIds.includes(user.id) && !g.isArchived
      );
      for (const group of groups) {
        socket.join(`group:${group.id}`);
      }
      console.log(`[socket] ${user.displayName} joined ${groups.length} group room(s).`);
    }

    // ── Welcome event ─────────────────────────────────────────────────────────
    socket.emit('welcome', {
      message:  `Welcome, ${user.displayName}!`,
      userId:   user.id,
      realmId:  user.realmId,
      role:     user.role,
    });

    // ── Client-requested room join (voluntary groups a student joins later) ───
    socket.on(SOCKET_EVENTS.JOIN_ROOM, ({ groupId }) => {
      if (!groupId) return;
      // Verify membership before joining
      const group = db.findOne('groups',
        (g) => g.id === groupId && g.realmId === user.realmId && g.memberIds.includes(user.id)
      );
      if (group) {
        socket.join(`group:${groupId}`);
        socket.emit(SOCKET_EVENTS.USER_JOINED_GROUP, { groupId, userId: user.id });
      }
    });

    // ── Client-requested room leave (voluntary groups only) ────────────────────
    socket.on(SOCKET_EVENTS.LEAVE_ROOM, ({ groupId }) => {
      if (!groupId) return;
      socket.leave(`group:${groupId}`);
    });

    // ── Typing indicators (forwarded to group room) ───────────────────────────
    socket.on(SOCKET_EVENTS.TYPING, ({ groupId }) => {
      if (!groupId) return;
      socket.to(`group:${groupId}`).emit(SOCKET_EVENTS.TYPING, {
        groupId,
        userId:      user.id,
        displayName: user.displayName,
      });
    });

    socket.on(SOCKET_EVENTS.STOP_TYPING, ({ groupId }) => {
      if (!groupId) return;
      socket.to(`group:${groupId}`).emit(SOCKET_EVENTS.STOP_TYPING, {
        groupId,
        userId: user.id,
      });
    });

    // ── Disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      console.log(`[socket] disconnected: ${user.displayName} | reason: ${reason}`);
    });

    // Phase 4: chat message sending, file handling, etc. will be added here by
    // importing chatHandler and calling:  chatHandler(io, socket, user);
  });
}

module.exports = socketHandler;
