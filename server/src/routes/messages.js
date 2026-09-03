import express from 'express';
import { getDb } from '../database.js';
import { JWT_SECRET } from './auth.js';
import jwt from 'jsonwebtoken';

const router = express.Router();
const MAX_MESSAGE_LENGTH = 4000;
const MAX_EMOJI_LENGTH = 32;

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

// Send message
router.post('/', authMiddleware, (req, res) => {
  const { channelId, content, replyTo, fileUrl, fileName, fileType } = req.body;
  const userId = req.user.userId;

  if (!Number.isInteger(Number(channelId))) return res.status(400).json({ error: 'Invalid channelId' });
  if (typeof content !== 'string' || content.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Message content must be at most ${MAX_MESSAGE_LENGTH} characters` });
  }
  if (replyTo != null && !Number.isInteger(Number(replyTo))) return res.status(400).json({ error: 'Invalid replyTo' });
  if (!content.trim() && !fileUrl) return res.status(400).json({ error: 'Message cannot be empty' });
  // Require membership on the channel's server before posting.
  getDb().get(
    'SELECT 1 FROM channels c JOIN server_members sm ON sm.server_id = c.server_id WHERE c.id = ? AND sm.user_id = ?',
    [channelId, userId],
    (mErr, member) => {
      if (mErr || !member) return res.status(403).json({ error: 'Not a member of this channel\'s server' });
      const insertMessage = () => getDb().run(
    `INSERT INTO messages (channel_id, user_id, content, reply_to, file_url, file_name, file_type) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [channelId, userId, content, replyTo ?? null, fileUrl || null, fileName || null, fileType || null],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to send message' });
      const msgId = this.lastID;
      getDb().get(
        `SELECT m.*, u.username, u.display_name, u.avatar,
                rm.content as reply_content, ru.username as reply_username, ru.display_name as reply_display_name
         FROM messages m 
         JOIN users u ON m.user_id = u.id 
         LEFT JOIN messages rm ON m.reply_to = rm.id
         LEFT JOIN users ru ON rm.user_id = ru.id
         WHERE m.id = ?`,
        [msgId],
        (err, row) => {
          if (err) return res.status(500).json({ error: 'Database error' });
          row.reactions = [];
          res.json(row);
        }
      );
    }
      );

      if (replyTo == null) return insertMessage();
      getDb().get(
        'SELECT id FROM messages WHERE id = ? AND channel_id = ?',
        [replyTo, channelId],
        (replyErr, reply) => {
          if (replyErr) return res.status(500).json({ error: 'Database error' });
          if (!reply) return res.status(400).json({ error: 'Reply must reference a message in this channel' });
          insertMessage();
        }
      );
    });
});

// Toggle reaction for a message
router.post('/:id/reactions', authMiddleware, (req, res) => {
  const messageId = req.params.id;
  const userId = req.user.userId;
  const { emoji } = req.body;

  if (typeof emoji !== 'string' || !emoji.trim() || emoji.length > MAX_EMOJI_LENGTH) return res.status(400).json({ error: 'Invalid emoji' });
  if (!Number.isInteger(Number(messageId))) return res.status(400).json({ error: 'Invalid messageId' });
  // Require access to the message's channel before allowing reactions.
  getDb().get(
    'SELECT 1 FROM messages m JOIN channels c ON c.id = m.channel_id JOIN server_members sm ON sm.server_id = c.server_id WHERE m.id = ? AND sm.user_id = ?',
    [messageId, userId],
    (aErr, allowed) => {
      if (aErr || !allowed) return res.status(403).json({ error: 'Not allowed to react to this message' });

  getDb().get(
    'SELECT id FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
    [messageId, userId, emoji],
    (err, existing) => {
      if (err) return res.status(500).json({ error: 'Database error' });

      if (existing) {
        getDb().run('DELETE FROM reactions WHERE id = ?', [existing.id], (dErr) => {
          if (dErr) return res.status(500).json({ error: 'Failed to remove reaction' });
          fetchUpdatedReactions(messageId, res);
        });
      } else {
        getDb().run('INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)', [messageId, userId, emoji], (iErr) => {
          if (iErr) return res.status(500).json({ error: 'Failed to add reaction' });
          fetchUpdatedReactions(messageId, res);
        });
      }
    }
  );
    });
});

function fetchUpdatedReactions(messageId, res) {
  getDb().all(
    `SELECT emoji, COUNT(*) as count, GROUP_CONCAT(user_id) as user_ids 
     FROM reactions WHERE message_id = ? GROUP BY emoji`,
    [messageId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      const reactions = (rows || []).map(r => ({
        emoji: r.emoji,
        count: Number(r.count),
        userIds: r.user_ids ? r.user_ids.split(',').map(Number) : []
      }));
      res.json({ messageId: Number(messageId), reactions });
    }
  );
}

// Get reactions for a message
router.get('/:id/reactions', authMiddleware, (req, res) => {
  const messageId = req.params.id;
  if (!Number.isInteger(Number(messageId))) return res.status(400).json({ error: 'Invalid messageId' });
  getDb().get(
    'SELECT 1 FROM messages m JOIN channels c ON c.id = m.channel_id JOIN server_members sm ON sm.server_id = c.server_id WHERE m.id = ? AND sm.user_id = ?',
    [messageId, req.user.userId],
    (err, allowed) => {
      if (err || !allowed) return res.status(403).json({ error: 'Not allowed to view reactions for this message' });
      fetchUpdatedReactions(messageId, res);
    }
  );
});

export default router;
