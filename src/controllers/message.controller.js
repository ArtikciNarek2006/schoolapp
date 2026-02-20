/**
 * message.controller.js  —  REST endpoints for chat history and file uploads
 *
 * GET    /api/realms/:realmId/groups/:groupId/messages               → paginated history
 * DELETE /api/realms/:realmId/groups/:groupId/messages/:msgId        → soft-delete message
 * POST   /api/realms/:realmId/groups/:groupId/messages/upload/image  → upload image
 * POST   /api/realms/:realmId/groups/:groupId/messages/upload/file   → upload file
 */

'use strict';

const db = require('../db/jsonDb');
const { HTTP, ROLES, SOCKET_EVENTS, MESSAGE_TYPES } = require('../../config/constants');

// ── Guard helper ──────────────────────────────────────────────────────────────
function assertMember(group, userId, res) {
  if (!group.memberIds.includes(userId)) {
    res.status(HTTP.FORBIDDEN).json({ success: false, message: 'You are not a member of this group.' });
    return false;
  }
  return true;
}

// ── GET /api/realms/:realmId/groups/:groupId/messages ─────────────────────────
/**
 * Paginated in reverse-chronological order.
 * Query: ?before=<msgId>&limit=50   (cursor-based pagination)
 */
function listMessages(req, res, next) {
  try {
    const { realmId, groupId } = req.params;

    const group = db.findOne('groups', (g) => g.id === groupId && g.realmId === realmId);
    if (!group) return res.status(HTTP.NOT_FOUND).json({ success: false, message: 'Group not found.' });
    if (!assertMember(group, req.user.id, res)) return;

    let messages = db.readMessages(groupId) || [];

    // Cursor: ?before=<msgId>
    const { before, limit = '50' } = req.query;
    const pageLimit = Math.min(parseInt(limit, 10) || 50, 100);

    if (before) {
      const idx = messages.findIndex((m) => m.id === before);
      if (idx > -1) messages = messages.slice(0, idx);
    }

    // Return the last `pageLimit` messages (newest last)
    const page = messages.slice(-pageLimit);

    // Enrich sender display names
    const userCache = {};
    const getUserDisplay = (senderId) => {
      if (!senderId) return null;
      if (!userCache[senderId]) {
        const u = db.findOne('users', (u) => u.id === senderId);
        userCache[senderId] = u ? { id: u.id, displayName: u.displayName, avatar: u.avatar } : { id: senderId, displayName: 'Unknown', avatar: null };
      }
      return userCache[senderId];
    };

    const enriched = page.map((m) => ({
      ...m,
      sender: getUserDisplay(m.senderId),
    }));

    const hasMore = messages.length > pageLimit && page.length === pageLimit;

    return res.status(HTTP.OK).json({
      success: true,
      count: enriched.length,
      hasMore,
      oldestId: page[0]?.id || null,
      data: enriched,
    });
  } catch (err) { next(err); }
}

// ── DELETE /api/realms/:realmId/groups/:groupId/messages/:msgId ──────────────
async function deleteMessage(req, res, next) {
  try {
    const { realmId, groupId, msgId } = req.params;

    const group = db.findOne('groups', (g) => g.id === groupId && g.realmId === realmId);
    if (!group) return res.status(HTTP.NOT_FOUND).json({ success: false, message: 'Group not found.' });
    if (!assertMember(group, req.user.id, res)) return;

    const messages = db.readMessages(groupId) || [];
    const msg = messages.find((m) => m.id === msgId);
    if (!msg) return res.status(HTTP.NOT_FOUND).json({ success: false, message: 'Message not found.' });
    if (msg.deletedAt) return res.status(HTTP.CONFLICT).json({ success: false, message: 'Message already deleted.' });

    // Only the sender or a senior_admin can delete
    const canDelete = msg.senderId === req.user.id || req.user.role === ROLES.SENIOR_ADMIN;
    if (!canDelete) return res.status(HTTP.FORBIDDEN).json({ success: false, message: 'Cannot delete this message.' });

    const updated = await db.updateMessage(groupId, msgId, {
      deletedAt: new Date().toISOString(),
      content: '[Message deleted]',
      fileUrl: null,
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`group:${groupId}`).emit(SOCKET_EVENTS.MESSAGE_DELETED, {
        groupId,
        messageId: msgId,
        deletedAt: updated.deletedAt,
      });
    }

    return res.status(HTTP.OK).json({ success: true, message: 'Message deleted.' });
  } catch (err) { next(err); }
}

// ── POST .../upload/image ─────────────────────────────────────────────────────
async function uploadImage(req, res, next) {
  try {
    const { realmId, groupId } = req.params;

    const group = db.findOne('groups', (g) => g.id === groupId && g.realmId === realmId);
    if (!group) return res.status(HTTP.NOT_FOUND).json({ success: false, message: 'Group not found.' });
    if (!assertMember(group, req.user.id, res)) return;
    if (group.isArchived) return res.status(HTTP.BAD_REQUEST).json({ success: false, message: 'Group is archived.' });

    if (!req.uploadedFile) {
      return res.status(HTTP.BAD_REQUEST).json({ success: false, message: 'No image file received.' });
    }

    const { url, originalName, mimeType, size } = req.uploadedFile;

    const msg = await db.appendMessage(groupId, {
      groupId,
      realmId,
      senderId: req.user.id,
      type: MESSAGE_TYPES.IMAGE,
      content: '',
      fileUrl: url,
      fileName: originalName,
      fileMime: mimeType,
      fileSize: size,
      replyToId: req.body.replyToId || null,
      readBy: [req.user.id],
      deletedAt: null,
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`group:${groupId}`).emit(SOCKET_EVENTS.NEW_MESSAGE, {
        message: { ...msg, sender: { id: req.user.id, displayName: req.user.displayName, avatar: req.user.avatar } },
      });
    }

    return res.status(HTTP.CREATED).json({ success: true, data: msg });
  } catch (err) { next(err); }
}

// ── POST .../upload/file ──────────────────────────────────────────────────────
async function uploadFile(req, res, next) {
  try {
    const { realmId, groupId } = req.params;

    const group = db.findOne('groups', (g) => g.id === groupId && g.realmId === realmId);
    if (!group) return res.status(HTTP.NOT_FOUND).json({ success: false, message: 'Group not found.' });
    if (!assertMember(group, req.user.id, res)) return;
    if (group.isArchived) return res.status(HTTP.BAD_REQUEST).json({ success: false, message: 'Group is archived.' });

    if (!req.uploadedFile) {
      return res.status(HTTP.BAD_REQUEST).json({ success: false, message: 'No file received.' });
    }

    const { url, originalName, mimeType, size } = req.uploadedFile;

    const msg = await db.appendMessage(groupId, {
      groupId,
      realmId,
      senderId: req.user.id,
      type: MESSAGE_TYPES.FILE,
      content: '',
      fileUrl: url,
      fileName: originalName,
      fileMime: mimeType,
      fileSize: size,
      replyToId: req.body.replyToId || null,
      readBy: [req.user.id],
      deletedAt: null,
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`group:${groupId}`).emit(SOCKET_EVENTS.NEW_MESSAGE, {
        message: { ...msg, sender: { id: req.user.id, displayName: req.user.displayName, avatar: req.user.avatar } },
      });
    }

    return res.status(HTTP.CREATED).json({ success: true, data: msg });
  } catch (err) { next(err); }
}

module.exports = { listMessages, deleteMessage, uploadImage, uploadFile };
