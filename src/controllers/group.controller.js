/**
 * group.controller.js  —  Chat group management
 *
 * GET    /api/realms/:realmId/groups             → list groups the caller is in
 * POST   /api/realms/:realmId/groups             → create a group
 * GET    /api/realms/:realmId/groups/:groupId    → group details + members
 * PATCH  /api/realms/:realmId/groups/:groupId    → update name/description (admin)
 * DELETE /api/realms/:realmId/groups/:groupId    → archive group (admin/senior)
 *
 * POST   /api/realms/:realmId/groups/:groupId/join      → voluntary join
 * POST   /api/realms/:realmId/groups/:groupId/leave     → voluntary leave
 * POST   /api/realms/:realmId/groups/:groupId/members   → add member (admin/senior)
 * DELETE /api/realms/:realmId/groups/:groupId/members/:userId  → remove member
 */

'use strict';

const db = require('../db/jsonDb');
const { HTTP, ROLES, GROUP_TYPES } = require('../../config/constants');

// ── Helpers ───────────────────────────────────────────────────────────────────
function getGroupScoped(groupId, realmId, res) {
  const g = db.findOne('groups', (g) => g.id === groupId && g.realmId === realmId);
  if (!g) { res.status(HTTP.NOT_FOUND).json({ success: false, message: 'Group not found.' }); return null; }
  return g;
}

function enrichGroup(group) {
  // Replace memberIds with lightweight user objects
  const members = db.findAll('users', (u) => group.memberIds.includes(u.id))
    .map(({ id, displayName, avatar, role }) => ({ id, displayName, avatar, role }));
  return { ...group, members };
}

function notifyGroupUpdate(req, group) {
  const io = req.app.get('io');
  if (io) io.to(`group:${group.id}`).emit('group_updated', { group });
}

// ── GET /api/realms/:realmId/groups ───────────────────────────────────────────
function listGroups(req, res, next) {
  try {
    const { realmId } = req.params;
    const { all } = req.query; // senior_admin can pass ?all=true to see all groups

    let groups;
    if (all === 'true' && (req.user.role === ROLES.SENIOR_ADMIN || req.user.role === ROLES.PROJECT_ADMIN)) {
      groups = db.findAll('groups', (g) => g.realmId === realmId);
    } else {
      groups = db.findAll('groups',
        (g) => g.realmId === realmId && g.memberIds.includes(req.user.id),
      );
    }

    // Sort: general first, then mandatory, then voluntary; then by name
    const typeOrder = { general: 0, mandatory: 1, voluntary: 2 };
    groups.sort((a, b) => {
      const to = (typeOrder[a.type] ?? 3) - (typeOrder[b.type] ?? 3);
      return to !== 0 ? to : a.name.localeCompare(b.name);
    });

    return res.status(HTTP.OK).json({ success: true, count: groups.length, data: groups });
  } catch (err) { next(err); }
}

// ── GET /api/realms/:realmId/groups/:groupId ──────────────────────────────────
function getGroup(req, res, next) {
  try {
    const { realmId, groupId } = req.params;
    const group = getGroupScoped(groupId, realmId, res);
    if (!group) return;

    // Students can only see groups they are in
    if (req.user.role === ROLES.STUDENT && !group.memberIds.includes(req.user.id)) {
      return res.status(HTTP.FORBIDDEN).json({ success: false, message: 'You are not a member of this group.' });
    }

    return res.status(HTTP.OK).json({ success: true, data: enrichGroup(group) });
  } catch (err) { next(err); }
}

// ── POST /api/realms/:realmId/groups ─────────────────────────────────────────
/**
 * Body: { name, description?, type }
 *
 * Rules:
 *  - Students can only create 'voluntary' groups.
 *  - Senior admin can create 'mandatory' groups.
 *  - 'general' groups are created programmatically only (realm creation).
 */
async function createGroup(req, res, next) {
  try {
    const { realmId } = req.params;
    const { name, description, type = GROUP_TYPES.VOLUNTARY } = req.body;

    if (!name || !name.trim()) {
      return res.status(HTTP.BAD_REQUEST).json({ success: false, message: 'Group name is required.' });
    }

    // Permission checks on type
    if (type === GROUP_TYPES.GENERAL) {
      return res.status(HTTP.FORBIDDEN).json({ success: false, message: 'General groups are created automatically.' });
    }
    if (type === GROUP_TYPES.MANDATORY && req.user.role !== ROLES.SENIOR_ADMIN) {
      return res.status(HTTP.FORBIDDEN).json({ success: false, message: 'Only senior admins can create mandatory groups.' });
    }
    if (![GROUP_TYPES.VOLUNTARY, GROUP_TYPES.MANDATORY].includes(type)) {
      return res.status(HTTP.BAD_REQUEST).json({ success: false, message: `type must be one of: ${GROUP_TYPES.VOLUNTARY}, ${GROUP_TYPES.MANDATORY}.` });
    }

    // Students need allowStudentVoluntaryGroups realm setting
    if (req.user.role === ROLES.STUDENT) {
      const realm = db.findOne('realms', (r) => r.id === realmId);
      if (!realm?.settings?.allowStudentVoluntaryGroups) {
        return res.status(HTTP.FORBIDDEN).json({ success: false, message: 'Student group creation is disabled for this realm.' });
      }
    }

    const group = await db.insert('groups', {
      realmId,
      name:             name.trim(),
      description:      description?.trim() || '',
      type,
      avatar:           null,
      createdBy:        req.user.id,
      adminIds:         [req.user.id],
      memberIds:        [req.user.id],
      pinnedMessageIds: [],
      isArchived:       false,
    });

    // Ensure the message file exists
    db.ensureGroupMessageFile(group.id);

    // Push to Socket.io: let the creator's socket join the new room
    const io = req.app.get('io');
    if (io) {
      // Find all sockets for this user and join them to the new group room
      const sockets = await io.fetchSockets();
      for (const s of sockets) {
        if (s.user?.id === req.user.id) s.join(`group:${group.id}`);
      }
    }

    return res.status(HTTP.CREATED).json({ success: true, data: enrichGroup(group) });
  } catch (err) { next(err); }
}

// ── PATCH /api/realms/:realmId/groups/:groupId ────────────────────────────────
async function updateGroup(req, res, next) {
  try {
    const { realmId, groupId } = req.params;
    const group = getGroupScoped(groupId, realmId, res);
    if (!group) return;

    // Only group admins or senior admin can edit
    const canEdit = group.adminIds.includes(req.user.id) || req.user.role === ROLES.SENIOR_ADMIN;
    if (!canEdit) return res.status(HTTP.FORBIDDEN).json({ success: false, message: 'Not a group admin.' });

    const { name, description, avatar } = req.body;
    const patch = {};
    if (name        !== undefined) patch.name        = name.trim();
    if (description !== undefined) patch.description = description.trim();
    if (avatar      !== undefined) patch.avatar      = avatar;

    const updated = await db.update('groups', groupId, patch);
    notifyGroupUpdate(req, updated);
    return res.status(HTTP.OK).json({ success: true, data: enrichGroup(updated) });
  } catch (err) { next(err); }
}

// ── DELETE /api/realms/:realmId/groups/:groupId ───────────────────────────────
async function archiveGroup(req, res, next) {
  try {
    const { realmId, groupId } = req.params;
    const group = getGroupScoped(groupId, realmId, res);
    if (!group) return;

    if (group.type === GROUP_TYPES.GENERAL) {
      return res.status(HTTP.FORBIDDEN).json({ success: false, message: 'The general group cannot be archived.' });
    }

    const canArchive = group.adminIds.includes(req.user.id) || req.user.role === ROLES.SENIOR_ADMIN;
    if (!canArchive) return res.status(HTTP.FORBIDDEN).json({ success: false, message: 'Not a group admin.' });

    const updated = await db.update('groups', groupId, { isArchived: true });
    notifyGroupUpdate(req, updated);
    return res.status(HTTP.OK).json({ success: true, message: 'Group archived.' });
  } catch (err) { next(err); }
}

// ── POST /api/realms/:realmId/groups/:groupId/join ────────────────────────────
async function joinGroup(req, res, next) {
  try {
    const { realmId, groupId } = req.params;
    const group = getGroupScoped(groupId, realmId, res);
    if (!group) return;

    if (group.type !== GROUP_TYPES.VOLUNTARY) {
      return res.status(HTTP.FORBIDDEN).json({ success: false, message: 'You can only join voluntary groups.' });
    }
    if (group.isArchived) {
      return res.status(HTTP.BAD_REQUEST).json({ success: false, message: 'This group is archived.' });
    }
    if (group.memberIds.includes(req.user.id)) {
      return res.status(HTTP.CONFLICT).json({ success: false, message: 'You are already a member.' });
    }

    const updated = await db.update('groups', groupId, {
      memberIds: [...group.memberIds, req.user.id],
    });

    // Emit a system message
    const { appendMessage } = require('../db/jsonDb');
    const sysMsg = await appendMessage(groupId, {
      groupId,
      realmId,
      senderId: null,
      type: 'system',
      content: `${req.user.displayName} joined the group.`,
      fileUrl: null, fileName: null, fileMime: null,
      replyToId: null, readBy: [], deletedAt: null,
    });

    const io = req.app.get('io');
    if (io) {
      // Join the socket to the room
      const sockets = await io.fetchSockets();
      for (const s of sockets) {
        if (s.user?.id === req.user.id) s.join(`group:${groupId}`);
      }
      io.to(`group:${groupId}`).emit('new_message', { message: sysMsg, group: updated });
      io.to(`group:${groupId}`).emit('user_joined_group', { groupId, userId: req.user.id, displayName: req.user.displayName });
    }

    return res.status(HTTP.OK).json({ success: true, data: enrichGroup(updated) });
  } catch (err) { next(err); }
}

// ── POST /api/realms/:realmId/groups/:groupId/leave ───────────────────────────
async function leaveGroup(req, res, next) {
  try {
    const { realmId, groupId } = req.params;
    const group = getGroupScoped(groupId, realmId, res);
    if (!group) return;

    if (group.type === GROUP_TYPES.GENERAL) {
      return res.status(HTTP.FORBIDDEN).json({ success: false, message: 'You cannot leave the general group.' });
    }
    if (group.type === GROUP_TYPES.MANDATORY) {
      return res.status(HTTP.FORBIDDEN).json({ success: false, message: 'You cannot leave a mandatory group.' });
    }
    if (!group.memberIds.includes(req.user.id)) {
      return res.status(HTTP.BAD_REQUEST).json({ success: false, message: 'You are not a member of this group.' });
    }

    const newMembers = group.memberIds.filter((id) => id !== req.user.id);
    const newAdmins  = group.adminIds.filter((id) => id !== req.user.id);

    const updated = await db.update('groups', groupId, {
      memberIds: newMembers,
      adminIds:  newAdmins,
    });

    const { appendMessage } = require('../db/jsonDb');
    const sysMsg = await appendMessage(groupId, {
      groupId,
      realmId,
      senderId: null,
      type: 'system',
      content: `${req.user.displayName} left the group.`,
      fileUrl: null, fileName: null, fileMime: null,
      replyToId: null, readBy: [], deletedAt: null,
    });

    const io = req.app.get('io');
    if (io) {
      const sockets = await io.fetchSockets();
      for (const s of sockets) {
        if (s.user?.id === req.user.id) s.leave(`group:${groupId}`);
      }
      io.to(`group:${groupId}`).emit('new_message', { message: sysMsg });
      io.to(`group:${groupId}`).emit('user_left_group', { groupId, userId: req.user.id });
    }

    return res.status(HTTP.OK).json({ success: true, message: 'You have left the group.' });
  } catch (err) { next(err); }
}

// ── POST /api/realms/:realmId/groups/:groupId/members ─────────────────────────
/**
 * Add one or more members to any group type (admin/senior only).
 * Body: { userIds: string[] }
 */
async function addMembers(req, res, next) {
  try {
    const { realmId, groupId } = req.params;
    const { userIds } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(HTTP.BAD_REQUEST).json({ success: false, message: 'userIds array is required.' });
    }

    const group = getGroupScoped(groupId, realmId, res);
    if (!group) return;

    const canManage = group.adminIds.includes(req.user.id) || req.user.role === ROLES.SENIOR_ADMIN;
    if (!canManage) return res.status(HTTP.FORBIDDEN).json({ success: false, message: 'Not a group admin.' });

    // Validate all userIds belong to this realm
    const toAdd = [];
    for (const uid of userIds) {
      const user = db.findOne('users', (u) => u.id === uid && u.realmId === realmId && u.isActive);
      if (!user) {
        return res.status(HTTP.NOT_FOUND).json({ success: false, message: `User "${uid}" not found in realm.` });
      }
      if (!group.memberIds.includes(uid)) toAdd.push(uid);
    }

    const updated = await db.update('groups', groupId, {
      memberIds: [...group.memberIds, ...toAdd],
    });

    const io = req.app.get('io');
    if (io) {
      // Auto-join newly added users' sockets to the room
      const sockets = await io.fetchSockets();
      for (const s of sockets) {
        if (toAdd.includes(s.user?.id)) s.join(`group:${groupId}`);
      }
      notifyGroupUpdate(req, updated);
    }

    return res.status(HTTP.OK).json({ success: true, data: enrichGroup(updated) });
  } catch (err) { next(err); }
}

// ── DELETE /api/realms/:realmId/groups/:groupId/members/:userId ───────────────
async function removeMember(req, res, next) {
  try {
    const { realmId, groupId, userId } = req.params;
    const group = getGroupScoped(groupId, realmId, res);
    if (!group) return;

    const canManage = group.adminIds.includes(req.user.id) || req.user.role === ROLES.SENIOR_ADMIN;
    if (!canManage) return res.status(HTTP.FORBIDDEN).json({ success: false, message: 'Not a group admin.' });

    if (group.type === GROUP_TYPES.GENERAL) {
      return res.status(HTTP.FORBIDDEN).json({ success: false, message: 'Cannot remove members from the general group.' });
    }
    if (!group.memberIds.includes(userId)) {
      return res.status(HTTP.NOT_FOUND).json({ success: false, message: 'User is not a member.' });
    }

    const updated = await db.update('groups', groupId, {
      memberIds: group.memberIds.filter((id) => id !== userId),
      adminIds:  group.adminIds.filter((id)  => id !== userId),
    });

    const io = req.app.get('io');
    if (io) {
      const sockets = await io.fetchSockets();
      for (const s of sockets) {
        if (s.user?.id === userId) s.leave(`group:${groupId}`);
      }
      notifyGroupUpdate(req, updated);
    }

    return res.status(HTTP.OK).json({ success: true, data: enrichGroup(updated) });
  } catch (err) { next(err); }
}

module.exports = {
  listGroups, getGroup, createGroup, updateGroup, archiveGroup,
  joinGroup, leaveGroup, addMembers, removeMember,
};
