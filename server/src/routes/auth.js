import 'dotenv/config';
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getDb } from '../database.js';
import { createIpRateLimiter, envLimit } from '../middleware/rateLimit.js';

const router = express.Router();
const ALLOWED_STATUS = new Set(['online', 'idle', 'dnd', 'invisible']);
const registerRateLimit = createIpRateLimiter({
  max: envLimit('AUTH_REGISTER_RATE_LIMIT', 8),
  windowMs: 15 * 60_000,
  message: 'Too many registration attempts. Please try again later.',
});
const loginRateLimit = createIpRateLimiter({
  max: envLimit('AUTH_LOGIN_RATE_LIMIT', 12),
  windowMs: 15 * 60_000,
  message: 'Too many login attempts. Please try again later.',
});
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET env var is required in production');
  }
  // Dev convenience: generate an ephemeral secret if not set. Tokens are
  // invalidated on every server restart, which is acceptable for development.
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
} else if (process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET env var must be at least 32 chars');
}
export const JWT_SECRET = process.env.JWT_SECRET;

// Pre-computed bcrypt hash used as a timing-safe dummy when the supplied
// email does not exist. Forces the login handler to always run a bcrypt
// comparison, eliminating the email-enumeration timing oracle (vuln-0001).
// Re-computed at startup; cost factor matches the real one (10) used in /register.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing-safety', 10);

// Common weak passwords rejected at registration. Real-world lists (e.g.
// HaveIBeenPwned top-100) are much longer, but this captures the worst
// offenders that bypass the length check on their own (vuln-0002).
const COMMON_WEAK_PASSWORDS = new Set([
  'password', '12345678', 'qwerty123', 'admin123', '11111111', 'password123',
  '1234567890', 'abc12345', 'qwertyuiop', 'iloveyou', 'sunshine',
]);

router.post('/register', registerRateLimit, (req, res) => {
  const { username, displayName, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Password policy (vuln-0002): min 10 chars, no leading/trailing whitespace,
  // and not in a small denylist of the most common passwords.
  if (password.length < 10) {
    return res.status(400).json({ error: 'Password must be at least 10 characters long' });
  }
  if (password.trim() !== password) {
    return res.status(400).json({ error: 'Password cannot start or end with whitespace' });
  }
  if (COMMON_WEAK_PASSWORDS.has(password.toLowerCase())) {
    return res.status(400).json({ error: 'Password is too common, please choose a stronger one' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const db = getDb();

  db.run(
    'INSERT INTO users (username, display_name, email, password_hash) VALUES (?, ?, ?, ?)',
    [username, displayName || username, email, passwordHash],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(409).json({ error: 'Username or email already exists' });
        }
        return res.status(500).json({ error: 'Database error' });
      }

      const userId = this.lastID;
      const token = jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '7d' });

      res.json({
        token,
        user: {
          id: userId,
          username,
          displayName: displayName || username,
          email,
          avatar: null,
          status: 'online'
        }
      });
    }
  );
});

router.post('/login', loginRateLimit, (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Missing credentials' });
  }

  getDb().get(
    'SELECT * FROM users WHERE email = ?',
    [email],
    (err, user) => {
      if (err) return res.status(500).json({ error: 'Internal error' });

      // Always run bcrypt.compareSync (against a real OR the dummy hash) so
      // that "user not found" and "wrong password" take statistically
      // identical time. Closes vuln-0001.
      const hashToCompare = user ? user.password_hash : DUMMY_HASH;
      const validPassword = bcrypt.compareSync(password, hashToCompare);

      if (!user || !validPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign(
        { userId: user.id, username: user.username },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      getDb().run('UPDATE users SET status = ? WHERE id = ?', ['online', user.id]);

      res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          email: user.email,
          avatar: user.avatar,
          status: 'online'
        }
      });
    }
  );
});

router.get('/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    getDb().get(
      'SELECT id, username, display_name, email, avatar, status, created_at FROM users WHERE id = ?',
      [decoded.userId],
      (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'User not found' });
        res.json({
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          email: user.email,
          avatar: user.avatar,
          status: user.status,
          createdAt: user.created_at
        });
      }
    );
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

router.put('/profile', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { displayName, avatar, status } = req.body;

    if (status !== undefined && status !== null && !ALLOWED_STATUS.has(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    if (displayName !== undefined && displayName !== null && (typeof displayName !== 'string' || displayName.length > 32 || /[\x00-\x1f<>]/.test(displayName))) {
      return res.status(400).json({ error: 'Invalid display name' });
    }
    if (avatar !== undefined && avatar !== null && !/^(https?:\/\/[\w.\-]+|\/uploads\/[\w.\-]+)$/.test(avatar)) {
      return res.status(400).json({ error: 'Invalid avatar URL' });
    }
    
    getDb().run(
      'UPDATE users SET display_name = COALESCE(?, display_name), avatar = COALESCE(?, avatar), status = COALESCE(?, status) WHERE id = ?',
      [displayName, avatar, status, decoded.userId],
      function(err) {
        if (err) return res.status(500).json({ error: 'Update failed' });
        res.json({ success: true });
      }
    );
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;
// JWT_SECRET is exported via the declaration above; do not re-export here.
