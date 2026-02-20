/**
 * jsonDb.js  —  Thin JSON-file database layer
 *
 * Every public function is synchronous-safe via a simple per-file write lock
 * (a Promise chain) so that concurrent async writes never corrupt a file.
 *
 * API:
 *   read(collection)              → Array  (throws if file missing)
 *   write(collection, data)       → void
 *   findAll(collection, predicate)→ Array  (filtered)
 *   findOne(collection, predicate)→ Object | null
 *   insert(collection, doc)       → doc   (with id + timestamps)
 *   update(collection, id, patch) → doc   (merges patch, bumps updatedAt)
 *   remove(collection, id)        → bool
 *
 *   readMessages(groupId)          → Array
 *   writeMessages(groupId, data)   → void
 *   appendMessage(groupId, msg)    → msg
 *   updateMessage(groupId, id, p)  → msg
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// ── Paths ─────────────────────────────────────────────────────────────────────
const DATA_DIR     = path.join(__dirname, '..', '..', 'data');
const MESSAGES_DIR = path.join(DATA_DIR, 'messages');

// ── Write-lock map (prevents concurrent writes corrupting a file) ─────────────
// key: absolute file path → value: Promise (the tail of the write chain)
const _locks = new Map();

function _withLock(filePath, fn) {
  const prev = _locks.get(filePath) || Promise.resolve();
  const next = prev.then(() => fn()).catch((err) => { throw err; });
  _locks.set(filePath, next.catch(() => {})); // don't let a rejection poison the chain
  return next;
}

// ── Low-level helpers ─────────────────────────────────────────────────────────
function _collectionPath(collection) {
  return path.join(DATA_DIR, `${collection}.json`);
}

function _messagesPath(groupId) {
  return path.join(MESSAGES_DIR, `${groupId}.json`);
}

function _readFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Collection file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  // Filter out schema comment objects (keys starting with _)
  return Array.isArray(parsed)
    ? parsed.filter((item) => !Object.keys(item).every((k) => k.startsWith('_')))
    : parsed;
}

function _writeFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ── Core collection API ───────────────────────────────────────────────────────

/**
 * Read all records from a collection (schema comments stripped).
 * @param {string} collection  e.g. 'users', 'realms'
 * @returns {Array}
 */
function read(collection) {
  return _readFile(_collectionPath(collection));
}

/**
 * Overwrite an entire collection with new data.
 * @param {string} collection
 * @param {Array}  data
 */
function write(collection, data) {
  return _withLock(_collectionPath(collection), () => {
    _writeFile(_collectionPath(collection), data);
  });
}

/**
 * Return all records matching the predicate (synchronous filter).
 */
function findAll(collection, predicate) {
  return read(collection).filter(predicate);
}

/**
 * Return the first record matching the predicate, or null.
 */
function findOne(collection, predicate) {
  return read(collection).find(predicate) || null;
}

/**
 * Insert a new record.  Adds `id` (uuid) if missing, plus `createdAt`/`updatedAt`.
 * @returns {Object} The inserted document (with generated id).
 */
async function insert(collection, doc) {
  const filePath = _collectionPath(collection);
  return _withLock(filePath, () => {
    const data = _readFile(filePath);
    const now  = new Date().toISOString();
    const record = {
      id: uuidv4(),
      ...doc,
      createdAt: doc.createdAt || now,
      updatedAt: doc.updatedAt || now,
    };
    data.push(record);
    _writeFile(filePath, data);
    return record;
  });
}

/**
 * Merge `patch` into the record with the given `id`.
 * Always bumps `updatedAt`.
 * @returns {Object|null} Updated document or null if not found.
 */
async function update(collection, id, patch) {
  const filePath = _collectionPath(collection);
  return _withLock(filePath, () => {
    const data  = _readFile(filePath);
    const index = data.findIndex((r) => r.id === id);
    if (index === -1) return null;
    const updated = { ...data[index], ...patch, updatedAt: new Date().toISOString() };
    data[index] = updated;
    _writeFile(filePath, data);
    return updated;
  });
}

/**
 * Remove the record with the given `id`.
 * @returns {boolean} true if deleted, false if not found.
 */
async function remove(collection, id) {
  const filePath = _collectionPath(collection);
  return _withLock(filePath, () => {
    const data    = _readFile(filePath);
    const before  = data.length;
    const filtered = data.filter((r) => r.id !== id);
    if (filtered.length === before) return false;
    _writeFile(filePath, filtered);
    return true;
  });
}

// ── Messages API (per-group files) ────────────────────────────────────────────

function readMessages(groupId) {
  const filePath = _messagesPath(groupId);
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed)
    ? parsed.filter((item) => !Object.keys(item).every((k) => k.startsWith('_')))
    : [];
}

function writeMessages(groupId, data) {
  const filePath = _messagesPath(groupId);
  return _withLock(filePath, () => {
    _writeFile(filePath, data);
  });
}

/**
 * Append a single message to a group's message file.
 * Adds `id` and `createdAt` if not present.
 * @returns {Object} The appended message document.
 */
async function appendMessage(groupId, msg) {
  const filePath = _messagesPath(groupId);
  return _withLock(filePath, () => {
    // Ensure the messages file exists
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(MESSAGES_DIR, { recursive: true });
      _writeFile(filePath, []);
    }
    const messages = readMessages(groupId);
    const record = {
      id: uuidv4(),
      ...msg,
      createdAt: msg.createdAt || new Date().toISOString(),
    };
    messages.push(record);
    _writeFile(filePath, messages);
    return record;
  });
}

/**
 * Patch a message within a group file (e.g., soft-delete, add to readBy).
 * @returns {Object|null}
 */
async function updateMessage(groupId, messageId, patch) {
  const filePath = _messagesPath(groupId);
  return _withLock(filePath, () => {
    const messages = readMessages(groupId);
    const index    = messages.findIndex((m) => m.id === messageId);
    if (index === -1) return null;
    messages[index] = { ...messages[index], ...patch };
    _writeFile(filePath, messages);
    return messages[index];
  });
}

// ── Utility: ensure a messages file exists for a new group ───────────────────
function ensureGroupMessageFile(groupId) {
  const filePath = _messagesPath(groupId);
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(MESSAGES_DIR, { recursive: true });
    _writeFile(filePath, []);
  }
}

module.exports = {
  read,
  write,
  findAll,
  findOne,
  insert,
  update,
  remove,
  readMessages,
  writeMessages,
  appendMessage,
  updateMessage,
  ensureGroupMessageFile,
};
