/**
 * upload.js  —  Multer v2 file upload middleware factory
 *
 * Two preconfigured middleware instances are exported:
 *
 *   uploadImage  – accepts a single field named "file", image MIME types only,
 *                  stored on disk under uploads/images/
 *
 *   uploadFile   – accepts a single field named "file", any safe MIME type,
 *                  stored on disk under uploads/files/
 *
 * Both enforce the MAX_FILE_SIZE_MB limit from .env (default 25 MB).
 *
 * The resolved path and URL are attached to req.uploadedFile so controllers
 * can read them without touching req.file directly.
 */

'use strict';

const path   = require('path');
const fs     = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { UPLOAD, HTTP } = require('../../config/constants');

// ── Ensure subdirectories exist ───────────────────────────────────────────────
const IMAGES_DIR = path.join(__dirname, '..', '..', UPLOAD.DIR, 'images');
const FILES_DIR  = path.join(__dirname, '..', '..', UPLOAD.DIR, 'files');
[IMAGES_DIR, FILES_DIR].forEach((d) => fs.mkdirSync(d, { recursive: true }));

// ── Shared disk-storage factory ───────────────────────────────────────────────
function makeStorage(subDir) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, subDir),
    filename:    (_req, file, cb) => {
      const ext  = path.extname(file.originalname).toLowerCase();
      const name = `${uuidv4()}${ext}`;
      cb(null, name);
    },
  });
}

// ── MIME allowlists ───────────────────────────────────────────────────────────
const IMAGE_MIMES = new Set(UPLOAD.ALLOWED_IMAGES);

// Safe file types: images + common document/archive types
const FILE_MIMES = new Set([
  ...UPLOAD.ALLOWED_IMAGES,
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
]);

function imageFilter(_req, file, cb) {
  if (IMAGE_MIMES.has(file.mimetype)) return cb(null, true);
  cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', `Only image files are allowed. Got: ${file.mimetype}`));
}

function fileFilter(_req, file, cb) {
  if (FILE_MIMES.has(file.mimetype)) return cb(null, true);
  cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', `File type not allowed: ${file.mimetype}`));
}

// ── Multer instances ──────────────────────────────────────────────────────────
const _uploadImage = multer({
  storage:  makeStorage(IMAGES_DIR),
  limits:   { fileSize: UPLOAD.MAX_SIZE_BYTES },
  fileFilter: imageFilter,
});

const _uploadFile = multer({
  storage: makeStorage(FILES_DIR),
  limits:  { fileSize: UPLOAD.MAX_SIZE_BYTES },
  fileFilter: fileFilter,
});

// ── Express middleware wrappers ───────────────────────────────────────────────
/**
 * Wraps multer callback in a Promise and normalises the error response.
 * Attaches req.uploadedFile = { url, originalName, mimeType, size } on success.
 */
function wrapMulter(multerMiddleware, subPath) {
  return (req, res, next) => {
    multerMiddleware(req, res, (err) => {
      if (err) {
        const message = err instanceof multer.MulterError
          ? `Upload error: ${err.message}`
          : `Upload failed: ${err.message}`;
        return res.status(HTTP.BAD_REQUEST).json({ success: false, message });
      }

      if (!req.file) {
        return res.status(HTTP.BAD_REQUEST).json({ success: false, message: 'No file was uploaded.' });
      }

      // Attach resolved metadata
      req.uploadedFile = {
        url:          `/uploads/${subPath}/${req.file.filename}`,
        originalName: req.file.originalname,
        mimeType:     req.file.mimetype,
        size:         req.file.size,
      };

      next();
    });
  };
}

const uploadImage = wrapMulter(_uploadImage.single('file'), 'images');
const uploadFile  = wrapMulter(_uploadFile.single('file'),  'files');

module.exports = { uploadImage, uploadFile };
