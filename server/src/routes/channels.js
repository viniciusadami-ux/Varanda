import express from 'express';
import { getDb } from '../database.js';
import { JWT_SECRET } from './auth.js';
import jwt from 'jsonwebtoken';
import { emitToServer } from '../realtime.js';

const router = express.Router();
const MAX_CHANNEL_NAME_LENGTH = 80;
const MAX_CATEGORY_NAME_LENGTH = 100;

function normalizedName(value, maxLength) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && name.length <= maxLength ? name : null;
}

function requireServerOwner(serverId, userId, res, next) {
  getDb().get(
    'SELECT id FROM servers WHERE id = ? AND owner_id = ?',
    [serverId, userId],
    (err, server) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!server) return res.status(403).json({ error: 'Only the server owner can manage channels' });
      next();
    }
  );
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

// Create category
router.post('/category', authMiddleware, (req, res) => {
  const { serverId, name } = req.body;
  if (!Number.isInteger(Number(serverId))) return res.status(400).json({ error: 'Invalid serverId' });
  const safeName = normalizedName(name, MAX_CATEGORY_NAME_LENGTH);
  if (!safeName) return res.status(400).json({ error: 'Invalid category name' });
  requireServerOwner(Number(serverId), req.user.userId, res, () => {
      getDb().run(
        'INSERT INTO categories (server_id, name) VALUES (?, ?)',
        [serverId, safeName],
        function(err) {
          if (err) return res.status(500).json({ error: 'Failed to create category' });
          emitToServer(Number(serverId), 'server_channels_updated', { serverId: Number(serverId) });
          res.json({ id: this.lastID, serverId: Number(serverId), name: safeName });
        }
      );
  });
});

// Create channel
router.post('/', authMiddleware, (req, res) => {
  const { serverId, categoryId, name, type } = req.body;
  if (!Number.isInteger(Number(serverId))) return res.status(400).json({ error: 'Invalid serverId' });
  const safeName = normalizedName(name, MAX_CHANNEL_NAME_LENGTH);
  const safeType = type === undefined ? 'text' : type;
  if (!safeName) return res.status(400).json({ error: 'Invalid channel name' });
  if (safeType !== 'text' && safeType !== 'voice') return res.status(400).json({ error: 'Invalid channel type' });
  if (categoryId != null && !Number.isInteger(Number(categoryId))) return res.status(400).json({ error: 'Invalid categoryId' });
  requireServerOwner(Number(serverId), req.user.userId, res, () => {
    const insertChannel = () => {
      getDb().run(
        'INSERT INTO channels (server_id, category_id, name, type) VALUES (?, ?, ?, ?)',
        [serverId, categoryId ?? null, safeName, safeType],
        function(err) {
          if (err) return res.status(500).json({ error: 'Failed to create channel' });
          const channel = { id: this.lastID, serverId: Number(serverId), categoryId: categoryId ?? null, name: safeName, type: safeType };
          emitToServer(Number(serverId), 'server_channels_updated', { serverId: Number(serverId) });
          res.json(channel);
        }
      );
    };
    if (categoryId == null) return insertChannel();
    getDb().get('SELECT id FROM categories WHERE id = ? AND server_id = ?', [categoryId, serverId], (err, category) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!category) return res.status(400).json({ error: 'Category does not belong to this server' });
      insertChannel();
    });
  });
});

// Update channel name
router.put('/:id', authMiddleware, (req, res) => {
  const { name } = req.body;
  const safeName = normalizedName(name, MAX_CHANNEL_NAME_LENGTH);
  if (!safeName) return res.status(400).json({ error: 'Invalid channel name' });
  if (!Number.isInteger(Number(req.params.id))) return res.status(400).json({ error: 'Invalid channel id' });
  getDb().get(
    'SELECT c.server_id FROM channels c JOIN servers s ON s.id = c.server_id WHERE c.id = ? AND s.owner_id = ?',
    [req.params.id, req.user.userId],
    (err, row) => {
      if (err || !row) return res.status(403).json({ error: 'Only the server owner can rename channels' });
      getDb().run('UPDATE channels SET name = ? WHERE id = ?', [safeName, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: 'Failed to update channel' });
        emitToServer(Number(row.server_id), 'server_channels_updated', { serverId: Number(row.server_id) });
        res.json({ success: true, id: req.params.id, name: safeName });
      });
    }
  );
});

// Get channel messages with replies and reactions
router.get('/:id/messages', authMiddleware, (req, res) => {
  const channelId = req.params.id;
  if (!Number.isInteger(Number(channelId))) return res.status(400).json({ error: 'Invalid channel id' });
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
  const requestedBefore = Number(req.query.before);
  const beforeId = Number.isInteger(requestedBefore) && requestedBefore > 0 ? requestedBefore : null;
  // Require membership on the channel's server before returning messages.
  getDb().get(
    'SELECT 1 FROM channels c JOIN server_members sm ON sm.server_id = c.server_id WHERE c.id = ? AND sm.user_id = ?',
    [channelId, req.user.userId],
    (mErr, member) => {
      if (mErr || !member) return res.status(403).json({ error: 'Not a member of this channel\'s server' });
      const predicates = ['m.channel_id = ?'];
      const params = [channelId];
      if (beforeId !== null) {
        predicates.push('m.id < ?');
        params.push(beforeId);
      }
      params.push(limit);

      getDb().all(
        `SELECT m.*, u.username, u.display_name, u.avatar,
                rm.content as reply_content, ru.username as reply_username, ru.display_name as reply_display_name
         FROM messages m
         JOIN users u ON m.user_id = u.id
         LEFT JOIN messages rm ON m.reply_to = rm.id
         LEFT JOIN users ru ON rm.user_id = ru.id
         WHERE ${predicates.join(' AND ')}
         ORDER BY m.created_at DESC, m.id DESC LIMIT ?`,
        params,
        (err, rows) => {
          if (err) return res.status(500).json({ error: 'Database error' });

          const messages = (rows || []).reverse();
          if (messages.length === 0) return res.json([]);

          const messageIds = messages.map(m => m.id);
          const placeholders = messageIds.map(() => '?').join(',');

          getDb().all(
            `SELECT message_id, emoji, COUNT(*) as count, GROUP_CONCAT(user_id) as user_ids
             FROM reactions WHERE message_id IN (${placeholders})
             GROUP BY message_id, emoji`,
            messageIds,
            (rErr, rRows) => {
              const reactionsByMsg = {};
              if (!rErr && rRows) {
                rRows.forEach(r => {
                  if (!reactionsByMsg[r.message_id]) reactionsByMsg[r.message_id] = [];
                  reactionsByMsg[r.message_id].push({
                    emoji: r.emoji,
                    count: Number(r.count),
                    userIds: r.user_ids ? r.user_ids.split(',').map(Number) : []
                  });
                });
              }

              messages.forEach(m => {
                m.reactions = reactionsByMsg[m.id] || [];
              });

              res.json(messages);
            }
          );
        }
      );
    }
  );
});

// Delete channel
router.delete('/:id', authMiddleware, (req, res) => {
  const channelId = req.params.id;
  if (!Number.isInteger(Number(channelId))) return res.status(400).json({ error: 'Invalid channel id' });
  // Owner-only delete: require that the requester owns the channel's server.
  getDb().get(
    'SELECT c.server_id FROM channels c JOIN servers s ON s.id = c.server_id WHERE c.id = ? AND s.owner_id = ?',
    [channelId, req.user.userId],
    (err, row) => {
      if (err || !row) return res.status(403).json({ error: 'Only the server owner can delete channels' });
      getDb().run('DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE channel_id = ?)', [channelId], () => {
        getDb().run('DELETE FROM messages WHERE channel_id = ?', [channelId], () => {
          getDb().run('DELETE FROM channels WHERE id = ?', [channelId], function(err) {
            if (err) return res.status(500).json({ error: 'Failed to delete' });
            emitToServer(Number(row.server_id), 'server_channels_updated', { serverId: Number(row.server_id) });
            res.json({ success: true });
          });
        });
      });
    }
  );
});

export default router;
