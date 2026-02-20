'use strict';

const router = require('express').Router({ mergeParams: true });
const ctrl   = require('../controllers/timetable.controller');
const { authenticate, requireRole, requireRealmAccess } = require('../middleware/auth');
const { ROLES } = require('../../config/constants');

// All timetable routes require auth + same-realm access
router.use(authenticate, requireRealmAccess);

// GET  /api/realms/:realmId/timetable          — any realm member
router.get('/', ctrl.getTimetable);

// GET  /api/realms/:realmId/timetable/today    — any realm member (today's schedule + attendance status)
router.get('/today', ctrl.getTodaySchedule);

// PUT  /api/realms/:realmId/timetable          — senior_admin only (full schedule replace)
router.put('/', requireRole(ROLES.SENIOR_ADMIN), ctrl.upsertTimetable);

// POST /api/realms/:realmId/timetable/:weekType/:day
router.post('/:weekType/:day', requireRole(ROLES.SENIOR_ADMIN), ctrl.addPeriod);

// PATCH /api/realms/:realmId/timetable/:weekType/:day/:periodId
router.patch('/:weekType/:day/:periodId', requireRole(ROLES.SENIOR_ADMIN), ctrl.updatePeriod);

// DELETE /api/realms/:realmId/timetable/:weekType/:day/:periodId
router.delete('/:weekType/:day/:periodId', requireRole(ROLES.SENIOR_ADMIN), ctrl.deletePeriod);

module.exports = router;
