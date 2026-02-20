/**
 * realm.controller.js  —  Realm management (Project Admin only)
 *
 * GET    /api/realms              → list all realms
 * POST   /api/realms              → create realm  +  assign first senior admin
 * GET    /api/realms/:realmId     → get single realm
 * PATCH  /api/realms/:realmId     → update realm settings
 * DELETE /api/realms/:realmId     → archive realm  (soft delete)
 * POST   /api/realms/:realmId/assign-senior  → assign / replace senior admin
 */

'use strict';

const db    = require('../db/jsonDb');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { HTTP, ROLES, REALM_STATUS, GROUP_TYPES } = require('../../config/constants');

// ── GET /api/realms ───────────────────────────────────────────────────────────
function listRealms(req, res, next) {
  try {
    const realms = db.read('realms');
    return res.status(HTTP.OK).json({ success: true, data: realms });
  } catch (err) { next(err); }
}

// ── GET /api/realms/:realmId ──────────────────────────────────────────────────
function getRealm(req, res, next) {
  try {
    const realm = db.findOne('realms', (r) => r.id === req.params.realmId);
    if (!realm) return res.status(HTTP.NOT_FOUND).json({ success: false, message: 'Realm not found.' });
    return res.status(HTTP.OK).json({ success: true, data: realm });
  } catch (err) { next(err); }
}

// ── POST /api/realms ──────────────────────────────────────────────────────────
/**
 * Body:
 *  name, code, description?, timezone?, academicYear?, semesterStart, semesterEnd
 *  seniorAdmin: { username, password, displayName }   ← first senior admin account
 */
async function createRealm(req, res, next) {
  try {
    const { name, code, description, timezone, academicYear, semesterStart, semesterEnd, seniorAdmin } = req.body;

    // ── Validation ────────────────────────────────────────────────────────────
    const errors = [];
    if (!name)          errors.push('name is required.');
    if (!code)          errors.push('code is required.');
    if (!semesterStart) errors.push('semesterStart is required (YYYY-MM-DD).');
    if (!semesterEnd)   errors.push('semesterEnd is required (YYYY-MM-DD).');
    if (!seniorAdmin?.username || !seniorAdmin?.password || !seniorAdmin?.displayName) {
      errors.push('seniorAdmin.username, seniorAdmin.password and seniorAdmin.displayName are required.');
    }
    if (errors.length) {
      return res.status(HTTP.BAD_REQUEST).json({ success: false, message: 'Validation failed.', errors });
    }

    // Realm code must be unique
    const codeConflict = db.findOne('realms', (r) => r.code.toLowerCase() === code.toLowerCase());
    if (codeConflict) {
      return res.status(HTTP.CONFLICT).json({ success: false, message: `Realm code "${code}" already exists.` });
    }

    // Username must be unique
    const userConflict = db.findOne('users', (u) => u.username === seniorAdmin.username.trim().toLowerCase());
    if (userConflict) {
      return res.status(HTTP.CONFLICT).json({ success: false, message: `Username "${seniorAdmin.username}" is already taken.` });
    }

    // ── Create the realm (realmId is needed for senior admin FK) ─────────────
    const realmId = uuidv4();
    const passwordHash = await bcrypt.hash(seniorAdmin.password, 12);
    const seniorId = uuidv4();

    // Create senior admin user
    await db.insert('users', {
      id: seniorId,
      realmId,
      username:     seniorAdmin.username.trim().toLowerCase(),
      passwordHash,
      role:         ROLES.SENIOR_ADMIN,
      displayName:  seniorAdmin.displayName.trim(),
      avatar:       null,
      isActive:     true,
      lastLoginAt:  null,
    });

    // Create the realm
    const realm = await db.insert('realms', {
      id:          realmId,
      name:        name.trim(),
      code:        code.trim().toUpperCase(),
      description: description?.trim() || '',
      status:      REALM_STATUS.ACTIVE,
      seniorAdminId: seniorId,
      settings: {
        maxAbsences:                 5,
        timezone:                    timezone || 'UTC',
        academicYear:                academicYear || '',
        semesterStart:               semesterStart,
        semesterEnd:                 semesterEnd,
        allowStudentVoluntaryGroups: true,
        notifyMinutesBefore:         5,
      },
    });

    // Auto-create the General group for the realm
    const groupId = uuidv4();
    await db.insert('groups', {
      id:               groupId,
      realmId,
      name:             `General — ${name.trim()}`,
      description:      `Realm-wide general channel for ${name.trim()}.`,
      type:             GROUP_TYPES.GENERAL,
      avatar:           null,
      createdBy:        seniorId,
      adminIds:         [seniorId],
      memberIds:        [seniorId],
      pinnedMessageIds: [],
      isArchived:       false,
    });

    // Ensure the message file exists for the general group
    const { ensureGroupMessageFile } = require('../db/jsonDb');
    ensureGroupMessageFile(groupId);

    return res.status(HTTP.CREATED).json({
      success: true,
      message: 'Realm created successfully.',
      data: { realm, seniorAdminId: seniorId },
    });
  } catch (err) { next(err); }
}

// ── PATCH /api/realms/:realmId ────────────────────────────────────────────────
async function updateRealm(req, res, next) {
  try {
    const { realmId } = req.params;
    const realm = db.findOne('realms', (r) => r.id === realmId);
    if (!realm) return res.status(HTTP.NOT_FOUND).json({ success: false, message: 'Realm not found.' });

    const { name, description, status, settings } = req.body;
    const patch = {};
    if (name)        patch.name        = name.trim();
    if (description !== undefined) patch.description = description.trim();
    if (status)      patch.status      = status;
    if (settings)    patch.settings    = { ...realm.settings, ...settings };

    const updated = await db.update('realms', realmId, patch);
    return res.status(HTTP.OK).json({ success: true, data: updated });
  } catch (err) { next(err); }
}

// ── DELETE /api/realms/:realmId ───────────────────────────────────────────────
async function archiveRealm(req, res, next) {
  try {
    const { realmId } = req.params;
    const realm = db.findOne('realms', (r) => r.id === realmId);
    if (!realm) return res.status(HTTP.NOT_FOUND).json({ success: false, message: 'Realm not found.' });

    await db.update('realms', realmId, { status: REALM_STATUS.ARCHIVED });
    return res.status(HTTP.OK).json({ success: true, message: 'Realm archived.' });
  } catch (err) { next(err); }
}

// ── POST /api/realms/:realmId/assign-senior ───────────────────────────────────
/**
 * Replace the senior admin for a realm.
 * Body: { userId }  ← must be an existing senior_admin in this realm
 */
async function assignSenior(req, res, next) {
  try {
    const { realmId } = req.params;
    const { userId }  = req.body;

    const realm = db.findOne('realms', (r) => r.id === realmId);
    if (!realm) return res.status(HTTP.NOT_FOUND).json({ success: false, message: 'Realm not found.' });

    const user = db.findOne('users', (u) => u.id === userId && u.realmId === realmId);
    if (!user) {
      return res.status(HTTP.NOT_FOUND).json({ success: false, message: 'User not found in this realm.' });
    }
    if (user.role !== ROLES.SENIOR_ADMIN) {
      return res.status(HTTP.BAD_REQUEST).json({ success: false, message: 'User must have role senior_admin.' });
    }

    const updated = await db.update('realms', realmId, { seniorAdminId: userId });
    return res.status(HTTP.OK).json({ success: true, data: updated });
  } catch (err) { next(err); }
}

module.exports = { listRealms, getRealm, createRealm, updateRealm, archiveRealm, assignSenior };
