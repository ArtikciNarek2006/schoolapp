/**
 * user.controller.js  —  User CRUD within a realm (Senior Admin only)
 *
 * GET    /api/realms/:realmId/users          → list users in realm
 * POST   /api/realms/:realmId/users          → create student account
 * GET    /api/realms/:realmId/users/:userId  → get single user
 * PATCH  /api/realms/:realmId/users/:userId  → update displayName / avatar / isActive
 * DELETE /api/realms/:realmId/users/:userId  → deactivate (soft) or hard delete
 *
 * Students cannot register themselves — only senior_admin creates accounts.
 * senior_admin cannot create another senior_admin (that is project_admin's job).
 */

'use strict';

const bcrypt = require('bcryptjs');
const db     = require('../db/jsonDb');
const { HTTP, ROLES } = require('../../config/constants');

// ── Helpers ───────────────────────────────────────────────────────────────────
function safeUser(user) {
  const { passwordHash, ...rest } = user;
  return rest;
}

// ── GET /api/realms/:realmId/users ────────────────────────────────────────────
function listUsers(req, res, next) {
  try {
    const { realmId } = req.params;
    const users = db.findAll('users', (u) => u.realmId === realmId).map(safeUser);
    return res.status(HTTP.OK).json({ success: true, data: users });
  } catch (err) { next(err); }
}

// ── GET /api/realms/:realmId/users/:userId ────────────────────────────────────
function getUser(req, res, next) {
  try {
    const { realmId, userId } = req.params;
    const user = db.findOne('users', (u) => u.id === userId && u.realmId === realmId);
    if (!user) return res.status(HTTP.NOT_FOUND).json({ success: false, message: 'User not found.' });
    return res.status(HTTP.OK).json({ success: true, data: safeUser(user) });
  } catch (err) { next(err); }
}

// ── POST /api/realms/:realmId/users ───────────────────────────────────────────
/**
 * Body: { username, password, displayName, role? }
 * role defaults to 'student'.  senior_admin cannot be created this way.
 */
async function createUser(req, res, next) {
  try {
    const { realmId } = req.params;
    const { username, password, displayName, role } = req.body;

    // ── Validate ──────────────────────────────────────────────────────────────
    const errors = [];
    if (!username)    errors.push('username is required.');
    if (!password)    errors.push('password is required.');
    if (!displayName) errors.push('displayName is required.');
    if (password && password.length < 8) errors.push('password must be at least 8 characters.');
    if (errors.length) {
      return res.status(HTTP.BAD_REQUEST).json({ success: false, message: 'Validation failed.', errors });
    }

    // senior_admin cannot create another senior_admin or project_admin
    if (role && role !== ROLES.STUDENT) {
      return res.status(HTTP.FORBIDDEN).json({
        success: false,
        message: 'You can only create student accounts.',
      });
    }

    // Check realm exists
    const realm = db.findOne('realms', (r) => r.id === realmId);
    if (!realm) return res.status(HTTP.NOT_FOUND).json({ success: false, message: 'Realm not found.' });

    // Username must be globally unique (prevent cross-realm login confusion)
    const conflict = db.findOne('users', (u) => u.username === username.trim().toLowerCase());
    if (conflict) {
      return res.status(HTTP.CONFLICT).json({ success: false, message: `Username "${username}" is already taken.` });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const newUser = await db.insert('users', {
      realmId,
      username:     username.trim().toLowerCase(),
      passwordHash,
      role:         ROLES.STUDENT,
      displayName:  displayName.trim(),
      avatar:       null,
      isActive:     true,
      lastLoginAt:  null,
    });

    // Auto-join the realm's General group
    const generalGroup = db.findOne('groups', (g) => g.realmId === realmId && g.type === 'general');
    if (generalGroup && !generalGroup.memberIds.includes(newUser.id)) {
      await db.update('groups', generalGroup.id, {
        memberIds: [...generalGroup.memberIds, newUser.id],
      });
    }

    return res.status(HTTP.CREATED).json({ success: true, data: safeUser(newUser) });
  } catch (err) { next(err); }
}

// ── PATCH /api/realms/:realmId/users/:userId ──────────────────────────────────
/**
 * Allowed patch fields: displayName, avatar, isActive, password
 * Senior admin can patch any user in their realm.
 * A student can patch only themselves (enforced in routes via requireSelfOrSenior).
 */
async function updateUser(req, res, next) {
  try {
    const { realmId, userId } = req.params;

    const user = db.findOne('users', (u) => u.id === userId && u.realmId === realmId);
    if (!user) return res.status(HTTP.NOT_FOUND).json({ success: false, message: 'User not found.' });

    const { displayName, avatar, isActive, password } = req.body;
    const patch = {};

    if (displayName !== undefined) patch.displayName = displayName.trim();
    if (avatar      !== undefined) patch.avatar      = avatar;
    if (isActive    !== undefined && req.user.role === ROLES.SENIOR_ADMIN) {
      patch.isActive = Boolean(isActive);
    }

    if (password) {
      if (password.length < 8) {
        return res.status(HTTP.BAD_REQUEST).json({ success: false, message: 'Password must be at least 8 characters.' });
      }
      patch.passwordHash = await bcrypt.hash(password, 12);
    }

    const updated = await db.update('users', userId, patch);
    return res.status(HTTP.OK).json({ success: true, data: safeUser(updated) });
  } catch (err) { next(err); }
}

// ── DELETE /api/realms/:realmId/users/:userId ─────────────────────────────────
/**
 * Soft-deletes by setting isActive = false.
 * Senior admin cannot delete themselves.
 */
async function deleteUser(req, res, next) {
  try {
    const { realmId, userId } = req.params;

    const user = db.findOne('users', (u) => u.id === userId && u.realmId === realmId);
    if (!user) return res.status(HTTP.NOT_FOUND).json({ success: false, message: 'User not found.' });

    if (userId === req.user.id) {
      return res.status(HTTP.FORBIDDEN).json({ success: false, message: 'You cannot delete your own account.' });
    }

    await db.update('users', userId, { isActive: false });
    return res.status(HTTP.OK).json({ success: true, message: 'User deactivated successfully.' });
  } catch (err) { next(err); }
}

module.exports = { listUsers, getUser, createUser, updateUser, deleteUser };
