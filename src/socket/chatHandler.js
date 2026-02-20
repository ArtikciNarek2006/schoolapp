/**
 * chatHandler.js  —  real-time chat over Socket.io
 *
 * Handles:
 *   SEND_MESSAGE   { groupId, type, content, replyToId? }  → NEW_MESSAGE to group room
 *   DELETE_MESSAGE { groupId, messageId }                  → MESSAGE_DELETED to group room
 *   MARK_READ      { groupId, messageId }                  → READ_RECEIPT to group room
 */

'use strict';

const db = require('../db/jsonDb');
const { SOCKET_EVENTS, MESSAGE_TYPES, ROLES } = require('../../config/constants');

module.exports = function chatHandler(io, socket, user) {

  // ── SEND_MESSAGE ─────────────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.SEND_MESSAGE, async (payload, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};

    try {
      const { groupId, type = MESSAGE_TYPES.TEXT, content, replyToId } = payload || {};

      if (!groupId || !content?.trim()) {
        return respond({ success: false, message: 'groupId and content are required.' });
      }
      if (type === MESSAGE_TYPES.IMAGE || type === MESSAGE_TYPES.FILE) {
        return respond({ success: false, message: 'Binary messages must be sent via the REST upload endpoints.' });
      }

      // Fetch and validate group
      const group = db.findOne('groups', (g) => g.id === groupId && g.realmId === user.realmId);
      if (!group) return respond({ success: false, message: 'Group not found.' });
      if (!group.memberIds.includes(user.id)) return respond({ success: false, message: 'Not a member.' });
      if (group.isArchived) return respond({ success: false, message: 'Group is archived.' });

      // Optional: validate replyToId exists
      if (replyToId) {
        const msgs = db.readMessages(groupId) || [];
        const ref = msgs.find((m) => m.id === replyToId);
        if (!ref) return respond({ success: false, message: 'replyToId message not found.' });
      }

      const msg = await db.appendMessage(groupId, {
        groupId,
        realmId:   user.realmId,
        senderId:  user.id,
        type,
        content:   content.trim(),
        fileUrl:   null,
        fileName:  null,
        fileMime:  null,
        fileSize:  null,
        replyToId: replyToId || null,
        readBy:    [user.id],
        deletedAt: null,
      });

      const enriched = {
        ...msg,
        sender: { id: user.id, displayName: user.displayName, avatar: user.avatar },
      };

      io.to(`group:${groupId}`).emit(SOCKET_EVENTS.NEW_MESSAGE, { message: enriched });

      return respond({ success: true, data: enriched });
    } catch (err) {
      console.error('[chatHandler] SEND_MESSAGE error:', err.message);
      return respond({ success: false, message: 'Internal server error.' });
    }
  });

  // ── DELETE_MESSAGE ────────────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.DELETE_MESSAGE, async (payload, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};

    try {
      const { groupId, messageId } = payload || {};
      if (!groupId || !messageId) return respond({ success: false, message: 'groupId and messageId are required.' });

      const group = db.findOne('groups', (g) => g.id === groupId && g.realmId === user.realmId);
      if (!group) return respond({ success: false, message: 'Group not found.' });
      if (!group.memberIds.includes(user.id)) return respond({ success: false, message: 'Not a member.' });

      const messages = db.readMessages(groupId) || [];
      const msg = messages.find((m) => m.id === messageId);
      if (!msg) return respond({ success: false, message: 'Message not found.' });
      if (msg.deletedAt) return respond({ success: false, message: 'Already deleted.' });

      const canDelete = msg.senderId === user.id || user.role === ROLES.SENIOR_ADMIN;
      if (!canDelete) return respond({ success: false, message: 'Cannot delete this message.' });

      const updated = await db.updateMessage(groupId, messageId, {
        deletedAt: new Date().toISOString(),
        content: '[Message deleted]',
        fileUrl: null,
      });

      io.to(`group:${groupId}`).emit(SOCKET_EVENTS.MESSAGE_DELETED, {
        groupId,
        messageId,
        deletedAt: updated.deletedAt,
      });

      return respond({ success: true });
    } catch (err) {
      console.error('[chatHandler] DELETE_MESSAGE error:', err.message);
      return respond({ success: false, message: 'Internal server error.' });
    }
  });

  // ── MARK_READ ─────────────────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.MARK_READ, async (payload, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};

    try {
      const { groupId, messageId } = payload || {};
      if (!groupId || !messageId) return respond({ success: false, message: 'groupId and messageId are required.' });

      const group = db.findOne('groups', (g) => g.id === groupId && g.realmId === user.realmId);
      if (!group) return respond({ success: false, message: 'Group not found.' });
      if (!group.memberIds.includes(user.id)) return respond({ success: false, message: 'Not a member.' });

      const messages = db.readMessages(groupId) || [];
      const msg = messages.find((m) => m.id === messageId);
      if (!msg) return respond({ success: false });

      if (!msg.readBy.includes(user.id)) {
        await db.updateMessage(groupId, messageId, {
          readBy: [...msg.readBy, user.id],
        });

        socket.to(`group:${groupId}`).emit(SOCKET_EVENTS.READ_RECEIPT, {
          groupId,
          messageId,
          userId:   user.id,
          readAt:   new Date().toISOString(),
        });
      }

      return respond({ success: true });
    } catch (err) {
      console.error('[chatHandler] MARK_READ error:', err.message);
      return respond({ success: false, message: 'Internal server error.' });
    }
  });
};
