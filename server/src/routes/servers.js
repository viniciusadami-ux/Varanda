import express from 'express';
import { getDb } from '../database.js';
import { JWT_SECRET } from './auth.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const router = express.Router();

function generateInviteCode() {
  return crypto.randomBytes(6).toString('base64url').slice(0, 8).toUpperCase();
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

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

// Create server
router.post('/', authMiddleware, async (req, res) => {
  const { name, icon } = req.body;
  const userId = req.user.userId;
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  if (!normalizedName || normalizedName.length > 100) {
    return res.status(400).json({ error: 'Server name must contain between 1 and 100 characters' });
  }

  try {
    const inviteCode = generateInviteCode();
    const server = await run(
      'INSERT INTO servers (name, icon, owner_id, invite_code) VALUES (?, ?, ?, ?)',
      [normalizedName, typeof icon === 'string' ? icon : null, userId, inviteCode]
    );
    const serverId = server.lastID;
    await run('INSERT INTO server_members (server_id, user_id, role) VALUES (?, ?, ?)', [serverId, userId, 'owner']);

    const textCategory = await run(
      'INSERT INTO categories (server_id, name, position) VALUES (?, ?, ?)',
      [serverId, 'CANAIS DE TEXTO', 0]
    );
    for (const [position, channelName] of ['geral', 'memes', 'conversa'].entries()) {
      await run(
        'INSERT INTO channels (server_id, category_id, name, type, position) VALUES (?, ?, ?, ?, ?)',
        [serverId, textCategory.lastID, channelName, 'text', position]
      );
    }

    const voiceCategory = await run(
      'INSERT INTO categories (server_id, name, position) VALUES (?, ?, ?)',
      [serverId, 'CANAIS DE VOZ', 1]
    );
    for (const [position, channelName] of ['Sala Geral', 'Jogando', 'Música'].entries()) {
      await run(
        'INSERT INTO channels (server_id, category_id, name, type, position) VALUES (?, ?, ?, ?, ?)',
        [serverId, voiceCategory.lastID, channelName, 'voice', position]
      );
    }

    res.status(201).json({ id: serverId, name: normalizedName, inviteCode });
  } catch (error) {
    console.error('Failed to create server:', error);
    res.status(500).json({ error: 'Failed to create server' });
  }
});

// Get user servers
router.get('/', authMiddleware, (req, res) => {
  const userId = req.user.userId;
  getDb().all(
    `SELECT s.* FROM servers s 
     JOIN server_members sm ON s.id = sm.server_id 
     WHERE sm.user_id = ? ORDER BY s.created_at`,
    [userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows);
    }
  );
});

// Get server by ID
router.get('/:id', authMiddleware, (req, res) => {
  const serverId = req.params.id;
  const userId = req.user.userId;

  // Membership gate: return 403 without leaking existence for non-members.
  // Closes vuln-0004 (IDOR leaking invite_code + members + channels).
  getDb().get(
    'SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?',
    [serverId, userId],
    (mErr, member) => {
      if (mErr || !member) return res.status(403).json({ error: 'Not a member of this server' });

      getDb().get('SELECT * FROM servers WHERE id = ?', [serverId], (err, server) => {
        if (err || !server) return res.status(404).json({ error: 'Server not found' });

        getDb().all(
          `SELECT u.id, u.username, u.display_name, u.avatar, u.status, sm.role
           FROM server_members sm JOIN users u ON sm.user_id = u.id
           WHERE sm.server_id = ?`,
          [serverId],
          (err, members) => {
            getDb().all(
              `SELECT c.*, cat.name as category_name
               FROM channels c LEFT JOIN categories cat ON c.category_id = cat.id
               WHERE c.server_id = ? ORDER BY cat.position, c.position`,
              [serverId],
              (err, channels) => {
                res.json({ ...server, members, channels });
              }
            );
          }
        );
      });
    }
  );
});

// Join server by invite
router.post('/join', authMiddleware, (req, res) => {
  const { code } = req.body;
  const userId = req.user.userId;

  getDb().get('SELECT * FROM servers WHERE invite_code = ?', [code], (err, server) => {
    if (err || !server) return res.status(404).json({ error: 'Invalid invite code' });
    
    getDb().run(
      'INSERT OR IGNORE INTO server_members (server_id, user_id) VALUES (?, ?)',
      [server.id, userId],
      (err) => {
        if (err) return res.status(500).json({ error: 'Failed to join' });
        res.json({ success: true, server });
      }
    );
  });
});

// Generate new invite
router.post('/:id/invite', authMiddleware, (req, res) => {
  const serverId = req.params.id;
  const userId = req.user.userId;
  const newCode = generateInviteCode();

  getDb().get('SELECT * FROM server_members WHERE server_id = ? AND user_id = ? AND role = ?', 
    [serverId, userId, 'owner'], (err, member) => {
      if (err || !member) return res.status(403).json({ error: 'Not authorized' });
      
      getDb().run('UPDATE servers SET invite_code = ? WHERE id = ?', [newCode, serverId], () => {
        res.json({ code: newCode });
      });
    }
  );
});

// Update server (name, icon)
router.put('/:id', authMiddleware, (req, res) => {
  const serverId = req.params.id;
  const userId = req.user.userId;
  const { name, icon } = req.body;

  getDb().get('SELECT * FROM servers WHERE id = ? AND owner_id = ?', [serverId, userId], (err, server) => {
    if (err || !server) return res.status(403).json({ error: 'Not authorized' });

    getDb().run(
      'UPDATE servers SET name = COALESCE(?, name), icon = COALESCE(?, icon) WHERE id = ?',
      [name, icon, serverId],
      function(uErr) {
        if (uErr) return res.status(500).json({ error: 'Failed to update server' });
        res.json({ success: true, id: serverId, name: name || server.name, icon: icon || server.icon });
      }
    );
  });
});

// Leave server
router.post('/:id/leave', authMiddleware, (req, res) => {
  const serverId = req.params.id;
  const userId = req.user.userId;

  getDb().get('SELECT * FROM servers WHERE id = ?', [serverId], (err, server) => {
    if (err || !server) return res.status(404).json({ error: 'Server not found' });
    if (server.owner_id === userId) {
      return res.status(400).json({ error: 'O dono não pode sair do servidor. Exclua o servidor se desejar.' });
    }

    getDb().run('DELETE FROM server_members WHERE server_id = ? AND user_id = ?', [serverId, userId], function(dErr) {
      if (dErr) return res.status(500).json({ error: 'Failed to leave server' });
      res.json({ success: true });
    });
  });
});

// Delete server
router.delete('/:id', authMiddleware, (req, res) => {
  const serverId = req.params.id;
  const userId = req.user.userId;

  getDb().get('SELECT * FROM servers WHERE id = ? AND owner_id = ?', [serverId, userId], (err, server) => {
    if (err || !server) return res.status(403).json({ error: 'Not authorized' });
    
    // Cascade delete reactions, messages, channels, categories, members, invites, and server
    getDb().run('DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE channel_id IN (SELECT id FROM channels WHERE server_id = ?))', [serverId], () => {
      getDb().run('DELETE FROM messages WHERE channel_id IN (SELECT id FROM channels WHERE server_id = ?)', [serverId], () => {
        getDb().run('DELETE FROM channels WHERE server_id = ?', [serverId], () => {
          getDb().run('DELETE FROM categories WHERE server_id = ?', [serverId], () => {
            getDb().run('DELETE FROM server_members WHERE server_id = ?', [serverId], () => {
              getDb().run('DELETE FROM invites WHERE server_id = ?', [serverId], () => {
                getDb().run('DELETE FROM servers WHERE id = ?', [serverId], () => {
                  res.json({ success: true });
                });
              });
            });
          });
        });
      });
    });
  });
});

export default router;
