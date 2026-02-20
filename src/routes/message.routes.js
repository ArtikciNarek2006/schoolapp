'use strict';

const router = require('express').Router({ mergeParams: true });
const { authenticate, requireRealmAccess } = require('../middleware/auth');
const { uploadImage: uploadImageMw, uploadFile: uploadFileMw } = require('../middleware/upload');
const mc = require('../controllers/message.controller');

const auth = [authenticate, requireRealmAccess];

// ── History ───────────────────────────────────────────────────────────────────
router.get   ('/',                ...auth, mc.listMessages);

// ── Delete ────────────────────────────────────────────────────────────────────
router.delete('/:msgId',          ...auth, mc.deleteMessage);

// ── File uploads (multer first, then controller) ──────────────────────────────
router.post('/upload/image',  ...auth, uploadImageMw, mc.uploadImage);
router.post('/upload/file',   ...auth, uploadFileMw,  mc.uploadFile);

module.exports = router;
