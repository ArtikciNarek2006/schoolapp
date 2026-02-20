'use strict';

const router = require('express').Router({ mergeParams: true });
const ctrl   = require('../controllers/notice.controller');
const { authenticate, requireRole, requireRealmAccess } = require('../middleware/auth');
const { ROLES } = require('../../config/constants');

router.use(authenticate, requireRealmAccess);

// GET  /api/realms/:realmId/notices            — all realm users (active notices only)
router.get('/', ctrl.listNotices);

// GET  /api/realms/:realmId/notices/:noticeId  — single notice
router.get('/:noticeId', ctrl.getNotice);

// POST /api/realms/:realmId/notices            — senior_admin only
router.post('/', requireRole(ROLES.SENIOR_ADMIN), ctrl.createNotice);

// PATCH /api/realms/:realmId/notices/:noticeId — senior_admin only
router.patch('/:noticeId', requireRole(ROLES.SENIOR_ADMIN), ctrl.updateNotice);

// DELETE /api/realms/:realmId/notices/:noticeId — senior_admin only
router.delete('/:noticeId', requireRole(ROLES.SENIOR_ADMIN), ctrl.deleteNotice);

module.exports = router;
