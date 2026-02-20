/**
 * errorHandler.js  —  Centralised Express error-handling middleware
 *
 * Must be registered as the LAST app.use() in server.js.
 * All controllers call next(err) to reach here.
 */

'use strict';

const { HTTP } = require('../../config/constants');

// ── Not-Found handler ─────────────────────────────────────────────────────────
function notFound(req, res, next) {
  const err = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  err.status = HTTP.NOT_FOUND;
  next(err);
}

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const isDev    = process.env.NODE_ENV !== 'production';
  const status   = err.status || err.statusCode || HTTP.SERVER_ERROR;
  const message  = err.message || 'An unexpected error occurred.';

  // Validation errors from our controllers have a structured body
  if (err.isValidation) {
    return res.status(HTTP.BAD_REQUEST).json({
      success: false,
      message,
      errors: err.errors || [],
    });
  }

  // Log full stack in development
  if (isDev) {
    console.error(`[error] ${status} — ${message}`);
    console.error(err.stack);
  } else if (status >= 500) {
    // Always log 5xx in production
    console.error(`[error] ${status} — ${message}`);
  }

  res.status(status).json({
    success: false,
    message,
    ...(isDev && { stack: err.stack }),
  });
}

// ── Validation helper (throw from controllers) ────────────────────────────────
function validationError(message, errors = []) {
  const err = new Error(message);
  err.status       = HTTP.BAD_REQUEST;
  err.isValidation = true;
  err.errors       = errors;
  return err;
}

module.exports = { notFound, errorHandler, validationError };
