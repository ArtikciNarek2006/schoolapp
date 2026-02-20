'use strict';

const router = require('express').Router({ mergeParams: true }); // inherit :realmId
const ctrl   = require('../controllers/user.controller');
const {
  authenticate,
  requireRole,
  requireRealmAccess,
  requireSelfOrSenior,
} = require('../middleware/auth');
const { ROLES } = require('../../config/constants');

// All user routes require authentication + realm membership
router.use(authenticate, requireRealmAccess);

// GET  /api/realms/:realmId/users
router.get('/', requireRole(ROLES.SENIOR_ADMIN, ROLES.PROJECT_ADMIN), ctrl.listUsers);

// POST /api/realms/:realmId/users   (senior_admin creates student accounts)
router.post('/', requireRole(ROLES.SENIOR_ADMIN), ctrl.createUser);

// GET  /api/realms/:realmId/users/:userId  (self or senior)
router.get('/:userId', requireSelfOrSenior, ctrl.getUser);

// PATCH /api/realms/:realmId/users/:userId  (self can update own profile; senior can update any)
router.patch('/:userId', requireSelfOrSenior, ctrl.updateUser);

// DELETE /api/realms/:realmId/users/:userId  (senior_admin only)
router.delete('/:userId', requireRole(ROLES.SENIOR_ADMIN), ctrl.deleteUser);

module.exports = router;
