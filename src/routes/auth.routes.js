'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', ctrl.login);

// POST /api/auth/logout
router.post('/logout', ctrl.logout);

// GET  /api/auth/me   (protected)
router.get('/me', authenticate, ctrl.me);

// POST /api/auth/change-password  (protected — any authenticated user)
router.post('/change-password', authenticate, ctrl.changePassword);

module.exports = router;
