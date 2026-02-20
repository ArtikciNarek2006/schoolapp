'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/realm.controller');
const { authenticate, requireRole } = require('../middleware/auth');
const { ROLES } = require('../../config/constants');

// Guard applied per-route (not globally) so that sub-resource routes
// mounted at /api/realms/:realmId/* by server.js are not blocked here.
const adminOnly = [authenticate, requireRole(ROLES.PROJECT_ADMIN)];

// GET  /api/realms
router.get('/', ...adminOnly, ctrl.listRealms);

// POST /api/realms
router.post('/', ...adminOnly, ctrl.createRealm);

// GET  /api/realms/:realmId
router.get('/:realmId', ...adminOnly, ctrl.getRealm);

// PATCH /api/realms/:realmId
router.patch('/:realmId', ...adminOnly, ctrl.updateRealm);

// DELETE /api/realms/:realmId  (archives)
router.delete('/:realmId', ...adminOnly, ctrl.archiveRealm);

// POST /api/realms/:realmId/assign-senior
router.post('/:realmId/assign-senior', ...adminOnly, ctrl.assignSenior);

module.exports = router;
