/**
 * server.js  —  Application Entry Point
 *
 * Boot sequence:
 *  1. Load env vars
 *  2. Run seed (idempotent bootstrap)
 *  3. Create Express app + middleware stack
 *  4. Mount API routes
 *  5. Serve static frontend
 *  6. Attach Socket.io (Phase 4)
 *  7. Start timetable notification scheduler (Phase 3)
 *  8. Listen
 */

'use strict';

// ── 1. Environment ─────────────────────────────────────────────────────────────
require('dotenv').config();

const http    = require('http');
const path    = require('path');
const express = require('express');
const { Server: SocketIO } = require('socket.io');

const seed           = require('./src/db/seed');
const authRoutes     = require('./src/routes/auth.routes');
const realmRoutes    = require('./src/routes/realm.routes');
const userRoutes     = require('./src/routes/user.routes');
const { notFound, errorHandler } = require('./src/middleware/errorHandler');

const PORT = parseInt(process.env.PORT, 10) || 3000;

// ── 2. Express App ─────────────────────────────────────────────────────────────
const app = express();

// ── Core middleware ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Parse cookies (needed for HttpOnly JWT cookie auth)
// We use a tiny inline parser to keep dependencies minimal
app.use((req, _res, next) => {
  const raw = req.headers.cookie || '';
  req.cookies = Object.fromEntries(
    raw.split(';').map((c) => c.trim().split('=').map(decodeURIComponent)).filter(([k]) => k)
  );
  next();
});

// Security headers (minimal, no helmet dependency needed)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ── Static files ──────────────────────────────────────────────────────────────
// Uploaded user files (images, PDFs, etc.)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// Frontend SPA
app.use(express.static(path.join(__dirname, 'public')));

// ── 3. API Routes ──────────────────────────────────────────────────────────────
app.use('/api/auth',   authRoutes);
app.use('/api/realms', realmRoutes);

// Nested: /api/realms/:realmId/users
app.use('/api/realms/:realmId/users', userRoutes);

// Timetable, attendance, notices routes  — wired in Phase 3
// Chat / message routes                 — wired in Phase 4

// ── 4. Catch-all: serve frontend for any non-API route (SPA fallback) ─────────
app.get(/^(?!\/api).*$/, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── 5. Error handlers (must be last) ─────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── 6. HTTP + Socket.io server ────────────────────────────────────────────────
const httpServer = http.createServer(app);

const io = new SocketIO(httpServer, {
  cors: {
    origin: false, // Same-origin only; update if deploying behind a reverse proxy
  },
});

// Attach io to app so routes/controllers can emit events
app.set('io', io);

// Socket.io logic wired in Phase 4
// require('./src/socket/index')(io);

// ── 7. Start ──────────────────────────────────────────────────────────────────
async function start() {
  try {
    // Idempotent bootstrap (creates project admin if missing, etc.)
    await seed();

    httpServer.listen(PORT, () => {
      console.log(`\n✅  Server running → http://localhost:${PORT}`);
      console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
      console.log(`   Press Ctrl+C to stop.\n`);
    });
  } catch (err) {
    console.error('[fatal] Failed to start server:', err);
    process.exit(1);
  }
}

start();

module.exports = { app, io, httpServer }; // exported for testing
