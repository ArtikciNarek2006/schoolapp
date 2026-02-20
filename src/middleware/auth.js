/**
 * auth.js  —  JWT authentication & role-based access control middleware
 *
 * authenticate      – verifies Bearer token, attaches req.user
 * requireRole(...roles) – factory that allows only the listed roles
 * requireSameRealm  – ensures req.user is in the same realm as the target resource
 */

'use strict';

const jwt = require('jsonwebtoken');
const db  = require('../db/jsonDb');
const { HTTP, ROLES } = require('../../config/constants');

// ── Helpers ───────────────────────────────────────────────────────────────────
function sendUnauthorized(res, message = 'Authentication required.') {
  return res.status(HTTP.UNAUTHORIZED).json({ success: false, message });
}
function sendForbidden(res, message = 'You do not have permission to perform this action.') {
  return res.status(HTTP.FORBIDDEN).json({ success: false, message });
}

// ── authenticate ──────────────────────────────────────────────────────────────
/**
 * Verifies the JWT from the Authorization header or the `token` cookie.
 * On success, attaches the full user document to `req.user`.
 */
async function authenticate(req, res, next) {
  try {
    // Accept token from Authorization header ("Bearer <token>") or cookie
    let token;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) return sendUnauthorized(res);

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Re-fetch the user from the DB on every request so deactivation is instant
    const user = db.findOne('users', (u) => u.id === payload.sub);
    if (!user)           return sendUnauthorized(res, 'User no longer exists.');
    if (!user.isActive)  return sendUnauthorized(res, 'Account has been deactivated.');

    // Attach safe user object (no password hash!) to the request
    const { passwordHash, ...safeUser } = user;
    req.user = safeUser;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return sendUnauthorized(res, 'Session expired. Please log in again.');
    }
    return sendUnauthorized(res, 'Invalid authentication token.');
  }
}

// ── requireRole ───────────────────────────────────────────────────────────────
/**
 * Factory middleware.  Usage:  requireRole(ROLES.SENIOR_ADMIN, ROLES.PROJECT_ADMIN)
 * Must be placed AFTER authenticate in the middleware chain.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return sendUnauthorized(res);
    if (!roles.includes(req.user.role)) {
      return sendForbidden(res, `Required role(s): ${roles.join(', ')}.`);
    }
    next();
  };
}

// ── requireRealmAccess ────────────────────────────────────────────────────────
/**
 * Ensures that the authenticated user belongs to the realm specified by
 * `req.params.realmId` (or `req.realmId` set by a previous middleware).
 *
 * Project admins bypass this check (they are realm-agnostic).
 */
function requireRealmAccess(req, res, next) {
  if (!req.user) return sendUnauthorized(res);

  // Project admin is always allowed — they operate across realms
  if (req.user.role === ROLES.PROJECT_ADMIN) return next();

  const targetRealmId = req.params.realmId || req.realmId;
  if (!targetRealmId) {
    return sendForbidden(res, 'Realm context is missing.');
  }

  if (req.user.realmId !== targetRealmId) {
    // Never reveal that the realm exists — treat as forbidden
    return sendForbidden(res, 'You do not have access to this realm.');
  }

  next();
}

// ── requireSelfOrSenior ───────────────────────────────────────────────────────
/**
 * Allows a user to operate on their own resource, OR allows senior_admin.
 * The target userId must be in `req.params.userId`.
 */
function requireSelfOrSenior(req, res, next) {
  if (!req.user) return sendUnauthorized(res);
  const isSelf   = req.user.id === req.params.userId;
  const isSenior = req.user.role === ROLES.SENIOR_ADMIN;
  const isAdmin  = req.user.role === ROLES.PROJECT_ADMIN;
  if (isSelf || isSenior || isAdmin) return next();
  return sendForbidden(res);
}

module.exports = {
  authenticate,
  requireRole,
  requireRealmAccess,
  requireSelfOrSenior,
};
