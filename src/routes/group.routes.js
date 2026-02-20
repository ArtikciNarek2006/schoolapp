'use strict';

const router = require('express').Router({ mergeParams: true });
const { authenticate, requireRole, requireRealmAccess } = require('../middleware/auth');
const { ROLES } = require('../../config/constants');
const gc = require('../controllers/group.controller');

const auth       = [authenticate, requireRealmAccess];
const seniorOnly = [authenticate, requireRealmAccess, requireRole(ROLES.SENIOR_ADMIN)];

// ── Collection ────────────────────────────────────────────────────────────────
router.get  ('/',             ...auth, gc.listGroups);
router.post ('/',             ...auth, gc.createGroup);

// ── Document ──────────────────────────────────────────────────────────────────
router.get   ('/:groupId',            ...auth, gc.getGroup);
router.patch ('/:groupId',            ...auth, gc.updateGroup);
router.delete('/:groupId',            ...auth, gc.archiveGroup);

// ── Membership ────────────────────────────────────────────────────────────────
router.post  ('/:groupId/join',               ...auth, gc.joinGroup);
router.post  ('/:groupId/leave',              ...auth, gc.leaveGroup);
router.post  ('/:groupId/members',            ...seniorOnly, gc.addMembers);
router.delete('/:groupId/members/:userId',    ...seniorOnly, gc.removeMember);

module.exports = router;
