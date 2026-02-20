'use strict';

const router = require('express').Router({ mergeParams: true });
const ctrl   = require('../controllers/attendance.controller');
const { authenticate, requireRole, requireRealmAccess } = require('../middleware/auth');
const { ROLES } = require('../../config/constants');

router.use(authenticate, requireRealmAccess);

// POST /api/realms/:realmId/attendance/checkin     — student self-service check-in
router.post('/checkin', ctrl.checkIn);

// GET  /api/realms/:realmId/attendance/me          — student's own history
router.get('/me', ctrl.getMyAttendance);

// GET  /api/realms/:realmId/attendance/analytics/me  — student's own analytics dashboard
router.get('/analytics/me', ctrl.getMyAnalytics);

// GET  /api/realms/:realmId/attendance/analytics/:userId  — senior_admin views any student
router.get('/analytics/:userId', requireRole(ROLES.SENIOR_ADMIN), ctrl.getUserAnalytics);

// GET  /api/realms/:realmId/attendance/today       — senior_admin class register
router.get('/today', requireRole(ROLES.SENIOR_ADMIN), ctrl.getTodayRegister);

// GET  /api/realms/:realmId/attendance             — senior_admin full filterable list
router.get('/', requireRole(ROLES.SENIOR_ADMIN), ctrl.listAttendance);

module.exports = router;
