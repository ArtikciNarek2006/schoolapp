/**
 * notice.controller.js  —  Notice board management
 *
 * GET    /api/realms/:realmId/notices              → List active notices (all realm users)
 * POST   /api/realms/:realmId/notices              → Create notice (senior_admin)
 * GET    /api/realms/:realmId/notices/:noticeId    → Get single notice
 * PATCH  /api/realms/:realmId/notices/:noticeId    → Update notice (senior_admin)
 * DELETE /api/realms/:realmId/notices/:noticeId    → Delete notice (senior_admin)
 */

'use strict';

const db = require('../db/jsonDb');
const { HTTP } = require('../../config/constants');

const VALID_PRIORITIES = ['normal', 'important', 'urgent'];

function getRealm(realmId, res) {
  const realm = db.findOne('realms', (r) => r.id === realmId);
  if (!realm) { res.status(HTTP.NOT_FOUND).json({ success: false, message: 'Realm not found.' }); return null; }
  return realm;
}

// ── GET /api/realms/:realmId/notices ─────────────────────────────────────────
/**
 * Returns notices that are not yet expired, sorted by priority then createdAt desc.
 * Senior admin can also see expired notices via ?includeExpired=true.
 */
function listNotices(req, res, next) {
  try {
    const { realmId } = req.params;
    const includeExpired = req.query.includeExpired === 'true';

    const now = new Date().toISOString();
    let notices = db.findAll('notices', (n) => n.realmId === realmId);

    if (!includeExpired) {
      notices = notices.filter((n) => !n.expiresAt || n.expiresAt > now);
    }

    const priorityOrder = { urgent: 0, important: 1, normal: 2 };
    notices.sort((a, b) => {
      const po = (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
      if (po !== 0) return po;
      return b.createdAt.localeCompare(a.createdAt);
    });

    return res.status(HTTP.OK).json({ success: true, count: notices.length, data: notices });
  } catch (err) { next(err); }
}

// ── GET /api/realms/:realmId/notices/:noticeId ────────────────────────────────
function getNotice(req, res, next) {
  try {
    const { realmId, noticeId } = req.params;
    const notice = db.findOne('notices', (n) => n.id === noticeId && n.realmId === realmId);
    if (!notice) return res.status(HTTP.NOT_FOUND).json({ success: false, message: 'Notice not found.' });
    return res.status(HTTP.OK).json({ success: true, data: notice });
  } catch (err) { next(err); }
}

// ── POST /api/realms/:realmId/notices ─────────────────────────────────────────
/**
 * Body: { title, body, priority?, expiresAt? }
 * After creation, emits a Socket.io 'notice_published' event to the realm room.
 */
async function createNotice(req, res, next) {
  try {
    const { realmId } = req.params;
    const { title, body, priority = 'normal', expiresAt } = req.body;

    const errors = [];
    if (!title || !title.trim()) errors.push('title is required.');
    if (!body  || !body.trim())  errors.push('body is required.');
    if (!VALID_PRIORITIES.includes(priority)) {
      errors.push(`priority must be one of: ${VALID_PRIORITIES.join(', ')}.`);
    }
    if (errors.length) {
      return res.status(HTTP.BAD_REQUEST).json({ success: false, message: 'Validation failed.', errors });
    }

    const notice = await db.insert('notices', {
      realmId,
      title:     title.trim(),
      body:      body.trim(),
      priority,
      createdBy: req.user.id,
      expiresAt: expiresAt || null,
    });

    // Push real-time notification to the realm
    const io = req.app.get('io');
    if (io) {
      io.to(realmId).emit('notice_published', {
        notice,
        publishedBy: req.user.displayName,
      });
    }

    return res.status(HTTP.CREATED).json({ success: true, data: notice });
  } catch (err) { next(err); }
}

// ── PATCH /api/realms/:realmId/notices/:noticeId ──────────────────────────────
async function updateNotice(req, res, next) {
  try {
    const { realmId, noticeId } = req.params;
    const notice = db.findOne('notices', (n) => n.id === noticeId && n.realmId === realmId);
    if (!notice) return res.status(HTTP.NOT_FOUND).json({ success: false, message: 'Notice not found.' });

    const { title, body, priority, expiresAt } = req.body;
    const patch = {};
    if (title    !== undefined) patch.title    = title.trim();
    if (body     !== undefined) patch.body     = body.trim();
    if (expiresAt !== undefined) patch.expiresAt = expiresAt;
    if (priority  !== undefined) {
      if (!VALID_PRIORITIES.includes(priority)) {
        return res.status(HTTP.BAD_REQUEST).json({ success: false, message: `Invalid priority "${priority}".` });
      }
      patch.priority = priority;
    }

    const updated = await db.update('notices', noticeId, patch);
    return res.status(HTTP.OK).json({ success: true, data: updated });
  } catch (err) { next(err); }
}

// ── DELETE /api/realms/:realmId/notices/:noticeId ─────────────────────────────
async function deleteNotice(req, res, next) {
  try {
    const { realmId, noticeId } = req.params;
    const notice = db.findOne('notices', (n) => n.id === noticeId && n.realmId === realmId);
    if (!notice) return res.status(HTTP.NOT_FOUND).json({ success: false, message: 'Notice not found.' });

    await db.remove('notices', noticeId);
    return res.status(HTTP.NO_CONTENT).send();
  } catch (err) { next(err); }
}

module.exports = { listNotices, getNotice, createNotice, updateNotice, deleteNotice };
