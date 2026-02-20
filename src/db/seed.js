/**
 * seed.js  —  Bootstrap script
 *
 * Run automatically on server startup (called from server.js before listen).
 * Idempotent: safe to call multiple times — it only writes if data is missing.
 *
 * Tasks:
 *  1. Ensure the Project Admin user exists (credentials from .env).
 *  2. Ensure data files exist and are valid JSON arrays.
 */

'use strict';

const fs      = require('fs');
const path    = require('path');
const bcrypt  = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const db      = require('./jsonDb');
const { ROLES } = require('../../config/constants');

// ── Collections that must exist as empty arrays ───────────────────────────────
const REQUIRED_COLLECTIONS = [
  'realms',
  'users',
  'timetables',
  'attendance',
  'groups',
  'notices',
];
const DATA_DIR     = path.join(__dirname, '..', '..', 'data');
const MESSAGES_DIR = path.join(DATA_DIR, 'messages');
const UPLOADS_DIR  = path.join(__dirname, '..', '..', 'uploads');

async function seed() {
  console.log('[seed] Running bootstrap checks…');

  // ── 1. Ensure directories exist ───────────────────────────────────────────
  [DATA_DIR, MESSAGES_DIR, UPLOADS_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`[seed] Created directory: ${dir}`);
    }
  });

  // ── 2. Ensure collection files exist ──────────────────────────────────────
  REQUIRED_COLLECTIONS.forEach((collection) => {
    const filePath = path.join(DATA_DIR, `${collection}.json`);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '[]', 'utf8');
      console.log(`[seed] Created empty collection: ${collection}.json`);
    }
  });

  // ── 3. Ensure Project Admin exists ────────────────────────────────────────
  const username = process.env.PROJECT_ADMIN_USERNAME || 'superadmin';
  const existing = db.findOne('users', (u) => u.role === ROLES.PROJECT_ADMIN);

  if (!existing) {
    const password = process.env.PROJECT_ADMIN_PASSWORD || 'Admin@1234';
    const passwordHash = await bcrypt.hash(password, 12);
    await db.insert('users', {
      id: uuidv4(),
      realmId: null,
      username,
      passwordHash,
      role: ROLES.PROJECT_ADMIN,
      displayName: 'Super Admin',
      avatar: null,
      isActive: true,
      lastLoginAt: null,
    });
    console.log(`[seed] Project Admin created → username: "${username}"`);
    console.log('[seed] ⚠  Change the default password via .env before going live!');
  } else {
    console.log(`[seed] Project Admin already exists (${existing.username}) — skipping.`);
  }

  console.log('[seed] Bootstrap complete.');
}

module.exports = seed;
