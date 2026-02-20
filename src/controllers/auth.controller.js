/**
 * auth.controller.js  —  Login, logout, current-user ("me")
 *
 * POST /api/auth/login    → { token, user }
 * POST /api/auth/logout   → clears cookie
 * GET  /api/auth/me       → { user }  (requires authenticate)
 */

'use strict';

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const db     = require('../db/jsonDb');
const { HTTP } = require('../../config/constants');

// ── helpers ───────────────────────────────────────────────────────────────────
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict',
  secure:   process.env.NODE_ENV === 'production',
  maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days in ms
};

function makeToken(userId) {
  return jwt.sign(
    { sub: userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function safeUser(user) {
  const { passwordHash, ...rest } = user;
  return rest;
}

// ── POST /api/auth/login ──────────────────────────────────────────────────────
async function login(req, res, next) {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(HTTP.BAD_REQUEST).json({
        success: false,
        message: 'Username and password are required.',
      });
    }

    const user = db.findOne('users', (u) => u.username === username.trim().toLowerCase());

    if (!user) {
      // Intentionally vague to prevent user enumeration
      return res.status(HTTP.UNAUTHORIZED).json({ success: false, message: 'Invalid credentials.' });
    }

    if (!user.isActive) {
      return res.status(HTTP.UNAUTHORIZED).json({ success: false, message: 'Account has been deactivated.' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(HTTP.UNAUTHORIZED).json({ success: false, message: 'Invalid credentials.' });
    }

    // Update last login timestamp (fire-and-forget, don't block the response)
    db.update('users', user.id, { lastLoginAt: new Date().toISOString() }).catch(() => {});

    const token = makeToken(user.id);

    // Set HttpOnly cookie AND return token in body (supports both browser and API clients)
    res.cookie('token', token, COOKIE_OPTS);

    return res.status(HTTP.OK).json({
      success: true,
      token,
      user: safeUser(user),
    });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
function logout(req, res) {
  res.clearCookie('token', { httpOnly: true, sameSite: 'strict' });
  return res.status(HTTP.OK).json({ success: true, message: 'Logged out successfully.' });
}

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
function me(req, res) {
  // req.user is already stripped of passwordHash by the auth middleware
  return res.status(HTTP.OK).json({ success: true, user: req.user });
}

// ── POST /api/auth/change-password ───────────────────────────────────────────
async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(HTTP.BAD_REQUEST).json({
        success: false,
        message: 'currentPassword and newPassword are required.',
      });
    }

    if (newPassword.length < 8) {
      return res.status(HTTP.BAD_REQUEST).json({
        success: false,
        message: 'New password must be at least 8 characters.',
      });
    }

    // Re-read user with hash
    const user = db.findOne('users', (u) => u.id === req.user.id);
    const match = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!match) {
      return res.status(HTTP.UNAUTHORIZED).json({ success: false, message: 'Current password is incorrect.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await db.update('users', user.id, { passwordHash });

    // Invalidate any cookies (client should discard token and re-login)
    res.clearCookie('token', { httpOnly: true, sameSite: 'strict' });

    return res.status(HTTP.OK).json({
      success: true,
      message: 'Password changed successfully. Please log in again.',
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { login, logout, me, changePassword };
