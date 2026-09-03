import express from 'express';
import { getDb } from '../database.js';
import { JWT_SECRET } from './auth.js';
import jwt from 'jsonwebtoken';
import { emitToUser } from '../realtime.js';

const router = express.Router();

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

// Send friend request
router.post('/request', authMiddleware, (req, res) => {
  const { username } = req.body;
  const senderId = req.user.userId;
  if (typeof username !== 'string' || !username.trim() || username.trim().length > 32) {
    return res.status(400).json({ error: 'Invalid username' });
  }

  getDb().get('SELECT id FROM users WHERE username = ? COLLATE NOCASE', [username.trim()], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'User not found' });
    if (user.id === senderId) return res.status(400).json({ error: 'Cannot add yourself' });

    getDb().get(
      `SELECT id, sender_id, receiver_id, status FROM friends
       WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)`,
      [senderId, user.id, user.id, senderId],
      (relationshipError, relationship) => {
        if (relationshipError) return res.status(500).json({ error: 'Database error' });
        if (relationship) {
          if (relationship.status === 'pending' && relationship.sender_id === user.id) {
            return getDb().run('UPDATE friends SET status = ? WHERE id = ?', ['accepted', relationship.id], (updateError) => {
              if (updateError) return res.status(500).json({ error: 'Failed to accept request' });
              emitToUser(user.id, 'friends_updated');
              return res.json({ success: true, status: 'accepted' });
            });
          }
          return res.status(409).json({ error: 'Já existe uma relação de amizade com este usuário.' });
        }
        getDb().run(
          'INSERT INTO friends (sender_id, receiver_id, status) VALUES (?, ?, ?)',
          [senderId, user.id, 'pending'],
          function(insertError) {
            if (insertError) return res.status(500).json({ error: 'Failed to send request' });
            emitToUser(user.id, 'friends_updated');
            res.status(201).json({ success: true, status: 'pending' });
          }
        );
      }
    );
  });
});

// Get friends and requests
router.get('/', authMiddleware, (req, res) => {
  const userId = req.user.userId;
  
  getDb().all(
    `SELECT f.*, 
      CASE WHEN f.sender_id = ? THEN receiver.id ELSE sender.id END as friend_id,
      CASE WHEN f.sender_id = ? THEN receiver.username ELSE sender.username END as friend_username,
      CASE WHEN f.sender_id = ? THEN receiver.display_name ELSE sender.display_name END as friend_display_name,
      CASE WHEN f.sender_id = ? THEN receiver.avatar ELSE sender.avatar END as friend_avatar,
      CASE WHEN f.sender_id = ? THEN receiver.status ELSE sender.status END as friend_status
     FROM friends f
     JOIN users sender ON f.sender_id = sender.id
     JOIN users receiver ON f.receiver_id = receiver.id
     WHERE f.sender_id = ? OR f.receiver_id = ?`,
    [userId, userId, userId, userId, userId, userId, userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows);
    }
  );
});

// Accept/Decline friend request
router.put('/:id', authMiddleware, (req, res) => {
  const { status } = req.body;
  if (!Number.isInteger(Number(req.params.id))) return res.status(400).json({ error: 'Invalid friendship id' });
  if (status !== 'accepted' && status !== 'declined') return res.status(400).json({ error: 'Invalid friendship status' });
  getDb().get(
    'SELECT sender_id, receiver_id FROM friends WHERE id = ? AND receiver_id = ?',
    [req.params.id, req.user.userId],
    (lookupError, friendship) => {
      if (lookupError || !friendship) return res.status(403).json({ error: 'Not authorized' });
      getDb().run(
        'UPDATE friends SET status = ? WHERE id = ? AND receiver_id = ?',
    [status, req.params.id, req.user.userId],
    function(err) {
      if (err || this.changes === 0) return res.status(403).json({ error: 'Not authorized' });
      emitToUser(friendship.sender_id, 'friends_updated');
      res.json({ success: true });
    }
      );
    }
  );
});

// Remove friend
router.delete('/:id', authMiddleware, (req, res) => {
  const userId = req.user.userId;
  getDb().get(
    'SELECT sender_id, receiver_id FROM friends WHERE id = ? AND (sender_id = ? OR receiver_id = ?)',
    [req.params.id, userId, userId],
    (lookupError, friendship) => {
      if (lookupError || !friendship) return res.status(403).json({ error: 'Not authorized' });
      getDb().run(
        'DELETE FROM friends WHERE id = ? AND (sender_id = ? OR receiver_id = ?)',
        [req.params.id, userId, userId],
        function(err) {
          if (err || this.changes === 0) return res.status(403).json({ error: 'Not authorized' });
          const otherUserId = friendship.sender_id === userId ? friendship.receiver_id : friendship.sender_id;
          emitToUser(otherUserId, 'friends_updated');
          res.json({ success: true });
        }
      );
    }
  );
});

// Get direct messages
router.get('/dm/:userId', authMiddleware, (req, res) => {
  const userId = req.user.userId;
  const otherId = req.params.userId;
  if (!Number.isInteger(Number(otherId))) return res.status(400).json({ error: 'Invalid user id' });
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
  const requestedBefore = Number(req.query.before);
  const beforeId = Number.isInteger(requestedBefore) && requestedBefore > 0 ? requestedBefore : null;
  const beforeClause = beforeId !== null ? ' AND dm.id < ?' : '';
  const params = [userId, otherId, otherId, userId];
  if (beforeId !== null) params.push(beforeId);
  params.push(limit);
  
  getDb().all(
    `SELECT dm.*, u.username, u.display_name, u.avatar 
     FROM direct_messages dm 
     JOIN users u ON dm.sender_id = u.id
     WHERE ((dm.sender_id = ? AND dm.receiver_id = ?) OR (dm.sender_id = ? AND dm.receiver_id = ?))${beforeClause}
     ORDER BY dm.created_at DESC, dm.id DESC LIMIT ?`,
    params,
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows.reverse());
    }
  );
});

export default router;
