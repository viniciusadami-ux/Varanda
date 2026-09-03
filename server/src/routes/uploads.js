import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, readFile, unlink } from 'fs';
import { JWT_SECRET } from './auth.js';
import jwt from 'jsonwebtoken';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../../../uploads');

mkdirSync(UPLOADS_DIR, { recursive: true });

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});

// Mimetypes that may NEVER appear as user-uploaded content (active content).
const NEVER_ALLOWED_MIMES = new Set([
  'text/html', 'text/xhtml', 'application/xhtml+xml', 'application/xml',
  'text/xml', 'image/svg+xml', 'application/javascript', 'text/javascript',
]);

// Allowlist of mimetypes permitted for upload.
const allowed = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/pdf', 'text/plain', 'application/zip',
]);

// Map each allowed mimetype to the file extensions that legitimately
// accompany it. Reject the upload if the multipart Content-Type and the
// originalname extension do not agree on a single allowed type.
const ALLOWED_EXTENSIONS = {
  'image/png':        new Set(['.png']),
  'image/jpeg':       new Set(['.jpg', '.jpeg']),
  'image/webp':       new Set(['.webp']),
  'image/gif':        new Set(['.gif']),
  'application/pdf':  new Set(['.pdf']),
  'text/plain':       new Set(['.txt']),
  'application/zip':  new Set(['.zip']),
};

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (NEVER_ALLOWED_MIMES.has(file.mimetype)) {
      return cb(new Error('File type not allowed'));
    }
    if (!allowed.has(file.mimetype)) {
      return cb(new Error('File type not allowed'));
    }
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExts = ALLOWED_EXTENSIONS[file.mimetype];
    if (!allowedExts || !allowedExts.has(ext)) {
      return cb(new Error('File extension does not match declared type'));
    }
    cb(null, true);
  },
});

const router = express.Router();

function hasExpectedSignature(filePath, mimeType) {
  return new Promise((resolve, reject) => {
    readFile(filePath, (err, data) => {
      if (err) return reject(err);
      const startsWith = (...bytes) => bytes.every((byte, index) => data[index] === byte);
      const isWebp = startsWith(0x52, 0x49, 0x46, 0x46) && data.subarray(8, 12).toString('ascii') === 'WEBP';
      const isText = !data.subarray(0, Math.min(data.length, 4096)).includes(0);
      const signatures = {
        'image/png': startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
        'image/jpeg': startsWith(0xff, 0xd8, 0xff),
        'image/webp': isWebp,
        'image/gif': startsWith(0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || startsWith(0x47, 0x49, 0x46, 0x38, 0x39, 0x61),
        'application/pdf': startsWith(0x25, 0x50, 0x44, 0x46, 0x2d),
        'application/zip': startsWith(0x50, 0x4b, 0x03, 0x04) || startsWith(0x50, 0x4b, 0x05, 0x06),
        'text/plain': isText,
      };
      resolve(Boolean(signatures[mimeType]));
    });
  });
}

function removeUploadedFile(filePath) {
  unlink(filePath, () => {});
}

router.post('/', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    if (!(await hasExpectedSignature(req.file.path, req.file.mimetype))) {
      removeUploadedFile(req.file.path);
      return res.status(400).json({ error: 'File contents do not match its declared type' });
    }
  } catch {
    removeUploadedFile(req.file.path);
    return res.status(500).json({ error: 'Failed to validate uploaded file' });
  }
  res.json({
    url: `/uploads/${req.file.filename}`,
    name: req.file.originalname,
    type: req.file.mimetype,
    size: req.file.size
  });
});

// Translate multer fileFilter errors (e.g. "File type not allowed",
// "File extension does not match declared type") into clean JSON 400s
// instead of leaking HTML stack traces as 500s. Closes the residual
// information-disclosure concern from vuln-0007.
router.use((err, req, res, next) => {
  if (err && /not allowed|extension does not match|invalid|unhealthy|too large|expected|file too large/i.test(err.message)) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

export default router;
