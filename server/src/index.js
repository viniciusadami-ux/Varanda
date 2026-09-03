import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import { initDatabase, getDb } from './database.js';
import authRoutes, { JWT_SECRET } from './routes/auth.js';
import serverRoutes from './routes/servers.js';
import channelRoutes from './routes/channels.js';
import messageRoutes from './routes/messages.js';
import friendRoutes from './routes/friends.js';
import uploadRoutes from './routes/uploads.js';
import { setSocketServer } from './realtime.js';
import { createIpRateLimiter, envLimit } from './middleware/rateLimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const parsedPort = Number.parseInt(process.env.PORT || '3000', 10);
const PORT = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 3000;
const HOST = process.env.HOST?.trim() || '0.0.0.0';
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads');
const MAX_VOICE_PARTICIPANTS = Math.min(
  Math.max(Number.parseInt(process.env.MAX_VOICE_PARTICIPANTS || '8', 10) || 8, 2),
  16
);
const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const MAX_MESSAGE_LENGTH = 4000;
const MAX_DM_LENGTH = 4000;

function parseUrls(raw) {
  return (raw || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

const configuredOrigins = new Set(
  parseUrls(process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .map((origin) => origin.replace(/\/$/, ''))
);

function isAllowedOrigin(origin) {
  // Electron's file renderer does not send a browser Origin header. Every
  // API and Socket.IO action remains authenticated with the JWT.
  if (!origin || origin.startsWith('file://')) return true;
  if (configuredOrigins.has('*')) return true;
  return configuredOrigins.has(origin.replace(/\/$/, ''));
}

const corsOptions = {
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(new Error(`CORS: origin not allowed: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: false,
};

function getIceServers() {
  const turnUrls = parseUrls(process.env.TURN_URLS || process.env.TURN_URL);
  const username = process.env.TURN_USERNAME?.trim();
  const credential = process.env.TURN_CREDENTIAL;
  const validTurnUrls = turnUrls.filter((url) => /^turns?:/i.test(url));
  if (!validTurnUrls.length || !username || !credential) {
    return DEFAULT_ICE_SERVERS;
  }
  return [...DEFAULT_ICE_SERVERS, { urls: validTurnUrls, username, credential }];
}

function createEventRateLimiter() {
  const windows = new Map();
  const limits = {
    webrtc_offer: { max: 20, durationMs: 10_000 },
    webrtc_answer: { max: 20, durationMs: 10_000 },
    webrtc_ice_candidate: { max: 150, durationMs: 10_000 },
    send_message: { max: 15, durationMs: 10_000 },
    edit_message: { max: 10, durationMs: 10_000 },
    delete_message: { max: 10, durationMs: 10_000 },
    toggle_reaction: { max: 30, durationMs: 10_000 },
    typing: { max: 12, durationMs: 3_000 },
    send_dm: { max: 10, durationMs: 10_000 },
  };
  return (eventName) => {
    const limit = limits[eventName];
    const now = Date.now();
    const current = windows.get(eventName);
    if (!current || now - current.startedAt >= limit.durationMs) {
      windows.set(eventName, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= limit.max;
  };
}

const app = express();
// Only trust X-Forwarded-For when the deployment explicitly declares that a
// reverse proxy is in front of this process. Direct/LAN hosting ignores it.
app.set('trust proxy', process.env.TRUST_PROXY === '1');
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: corsOptions,
  maxHttpBufferSize: 1e6,
});
setSocketServer(io);

// JWT middleware: every connection must present a valid Bearer token in
// handshake.auth OR connect payload. Drops the connection otherwise.
// Closes SEC-002, SEC-007, SEC-008, SEC-009 — server no longer trusts
// userId/senderId/channelId from clients; it derives them from socket.data.user.
io.use((socket, next) => {
  let raw =
    socket.handshake.auth?.token ||
    socket.handshake.auth?.Authorization ||
    socket.handshake.headers?.authorization;
  if (raw && raw.startsWith('Bearer ')) raw = raw.slice(7);
  if (!raw && socket.handshake.query?.token) raw = socket.handshake.query.token;

  if (!raw) return next(new Error('auth: token required'));

  try {
    const decoded = jwt.verify(raw, JWT_SECRET, { algorithms: ['HS256'] });
    if (!decoded?.userId) return next(new Error('auth: invalid token payload'));
    socket.data.user = { id: decoded.userId, username: decoded.username };
    next();
  } catch (e) {
    next(new Error('auth: invalid or expired token'));
  }
});

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

const apiRateLimit = createIpRateLimiter({
  max: envLimit('API_RATE_LIMIT', 240),
  windowMs: 60_000,
});
const healthRateLimit = createIpRateLimiter({
  max: envLimit('HEALTH_RATE_LIMIT', 60),
  windowMs: 60_000,
});

app.get('/health', healthRateLimit, (_req, res) => {
  res.json({ status: 'ok', service: 'discord2', version: '1.0.0' });
});

// Serve uploaded files with strict security headers. Force attachment so the
// browser never renders them inline (defeats stored XSS via uploaded HTML/SVG).
// The Electron session header in app/main.js only protects the Electron window,
// not these responses.
app.use(
  '/uploads',
  express.static(UPLOADS_DIR, {
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'"
      );
    },
  })
);

// Routes
app.use('/api', apiRateLimit);
app.use('/api/auth', authRoutes);
app.use('/api/servers', serverRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/uploads', uploadRoutes);

// Initialize database
initDatabase();

const voiceChannels = new Map(); // channelId -> Map<userId, participantInfo>

// Presence: active sockets per userId (supports multi-instance)
const activeSocketsByUser = new Map(); // userId -> Set<socketId>
const pendingOfflineTimers = new Map(); // userId -> timeoutId

function getEffectiveStatus(dbStatus) {
  return dbStatus === 'invisible' ? 'offline' : dbStatus;
}

function broadcastPresenceToFriends(userId, effectiveStatus) {
  // Friends-only broadcast, not global. Queries accepted friendships.
  getDb().all(
    `SELECT CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as friend_id
     FROM friends WHERE (sender_id = ? OR receiver_id = ?) AND status = 'accepted'`,
    [userId, userId, userId],
    (err, rows) => {
      if (err || !rows) return;
      for (const row of rows) {
        const friendId = row.friend_id;
        io.to(`user_${friendId}`).emit('user_status', { userId, status: effectiveStatus });
      }
    }
  );
}

function sendPresenceSnapshot(targetSocket, userId) {
  getDb().all(
    `SELECT
       CASE WHEN f.sender_id = ? THEN f.receiver_id ELSE f.sender_id END as friend_id,
       u.status as friend_status
     FROM friends f
     JOIN users u ON u.id = CASE WHEN f.sender_id = ? THEN f.receiver_id ELSE f.sender_id END
     WHERE (f.sender_id = ? OR f.receiver_id = ?) AND f.status = 'accepted'`,
    [userId, userId, userId, userId],
    (err, rows) => {
      if (err || !rows) {
        targetSocket.emit('presence_snapshot', {});
        return;
      }
      const snapshot = {};
      for (const row of rows) {
        let s = row.friend_status || 'offline';
        // If friend has active socket but DB says offline (race), treat as online
        if (activeSocketsByUser.has(row.friend_id) && s === 'offline') s = 'online';
        const effective = getEffectiveStatus(s);
        snapshot[row.friend_id] = effective;
        // Back-compat: also emit individual user_status for older clients
        targetSocket.emit('user_status', { userId: row.friend_id, status: effective });
      }
      targetSocket.emit('presence_snapshot', snapshot);
    }
  );
}

// Socket.IO handlers — every authenticated user is identified by
// `socket.data.user.id` from the JWT (set in io.use middleware above).
// Client-supplied userId/senderId is NEVER trusted.
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  const allowSocketEvent = createEventRateLimiter();

  // Personal room for direct messages, friendship updates and future private
  // notifications. A user can have more than one client connected safely.
  socket.join(`user_${socket.data.user.id}`);

  // Compatibility shim: previous code stored socket.userId; downstream
  // events (webrtc_offer/answer/ice) read socket.userId. Keep both in sync.
  socket.userId = socket.data.user.id;

  // Presence tracking: multi-socket support with reconnection grace
  const presenceUserId = socket.data.user.id;
  let presenceSet = activeSocketsByUser.get(presenceUserId);
  if (!presenceSet) {
    presenceSet = new Set();
    activeSocketsByUser.set(presenceUserId, presenceSet);
  }
  if (pendingOfflineTimers.has(presenceUserId)) {
    clearTimeout(pendingOfflineTimers.get(presenceUserId));
    pendingOfflineTimers.delete(presenceUserId);
  }
  const wasFirstPresence = presenceSet.size === 0;
  presenceSet.add(socket.id);
  if (wasFirstPresence) {
    getDb().get('SELECT status FROM users WHERE id = ?', [presenceUserId], (pErr, pRow) => {
      if (pErr || !pRow) return;
      const dbStatus = pRow.status || 'offline';
      if (dbStatus === 'offline') {
        getDb().run('UPDATE users SET status = ? WHERE id = ?', ['online', presenceUserId], () => {
          broadcastPresenceToFriends(presenceUserId, 'online');
        });
      } else if (dbStatus !== 'invisible') {
        broadcastPresenceToFriends(presenceUserId, getEffectiveStatus(dbStatus));
      }
    });
  }
  sendPresenceSnapshot(socket, presenceUserId);

  // join_server validates that the user is actually a member of the server.
  socket.on('join_server', (serverId) => {
    if (!Number.isInteger(serverId)) return;
    getDb().get(
      'SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?',
      [serverId, socket.data.user.id],
      (err, row) => {
        if (!err && row) socket.join(`server_${serverId}`);
      }
    );
  });

  socket.on('leave_server', (serverId) => {
    if (!Number.isInteger(serverId)) return;
    socket.leave(`server_${serverId}`);
  });

  socket.on('join_channel', (channelId) => {
    if (!Number.isInteger(channelId)) return;
    const userId = socket.data.user.id;

    // Membership check before joining the room. Closes vuln-0006 (eavesdropping).
    getDb().get(
      'SELECT 1 FROM channels c JOIN server_members sm ON sm.server_id = c.server_id WHERE c.id = ? AND sm.user_id = ?',
      [channelId, userId],
      (mErr, row) => {
        if (!mErr && row) socket.join(`channel_${channelId}`);
      }
    );
  });

  socket.on('leave_channel', (channelId) => {
    if (!Number.isInteger(channelId)) return;
    socket.leave(`channel_${channelId}`);
  });

  socket.on('send_message', (data) => {
    const { channelId, content, replyTo, fileUrl, fileName, fileType } = data || {};
    if (!Number.isInteger(channelId) || typeof content !== 'string') return;
    if (replyTo != null && !Number.isInteger(replyTo)) return;
    if (content.length > MAX_MESSAGE_LENGTH || (!content.trim() && !fileUrl)) return;
    if (!allowSocketEvent('send_message')) return;
    const userId = socket.data.user.id;

    // Membership check: must be a member of the server that owns the channel
    // before inserting or broadcasting. Closes vuln-0003.
    getDb().get(
      'SELECT 1 FROM channels c JOIN server_members sm ON sm.server_id = c.server_id WHERE c.id = ? AND sm.user_id = ?',
      [channelId, userId],
      (mErr, member) => {
        if (mErr || !member) return;
        const insertMessage = () => getDb().run(
          `INSERT INTO messages (channel_id, user_id, content, reply_to, file_url, file_name, file_type)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [channelId, userId, content, replyTo ?? null, fileUrl || null, fileName || null, fileType || null],
          function(err) {
            if (err) return;
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
                if (!err && row) {
                  row.reactions = [];
                  io.to(`channel_${channelId}`).emit('new_message', row);
                }
              }
            );
          }
        );

        if (replyTo == null) return insertMessage();
        getDb().get(
          'SELECT id FROM messages WHERE id = ? AND channel_id = ?',
          [replyTo, channelId],
          (replyErr, reply) => {
            if (!replyErr && reply) insertMessage();
          }
        );
      }
    );
  });

  socket.on('edit_message', (data) => {
    const { messageId, content } = data || {};
    if (!Number.isInteger(messageId) || typeof content !== 'string' || content.length > MAX_MESSAGE_LENGTH) return;
    if (!allowSocketEvent('edit_message')) return;
    const userId = socket.data.user.id;

    // Update + RETURNING channel_id in one query. Closes vuln-0008 (broadcast scope)
    // and preserves the owner-only check (user_id = ?).
    getDb().get(
      `UPDATE messages SET content = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ? RETURNING channel_id`,
      [content, messageId, userId],
      (err, row) => {
        if (!err && row) {
          io.to(`channel_${row.channel_id}`).emit('message_edited', { messageId, content });
        }
      }
    );
  });

  socket.on('delete_message', (data) => {
    const { messageId } = data || {};
    if (!Number.isInteger(messageId)) return;
    if (!allowSocketEvent('delete_message')) return;
    const userId = socket.data.user.id;

    // Delete + RETURNING channel_id. Closes vuln-0008 (broadcast scope).
    // Owner-only check preserved (user_id = ?).
    getDb().get(
      'DELETE FROM messages WHERE id = ? AND user_id = ? RETURNING channel_id',
      [messageId, userId],
      (err, row) => {
        if (!err && row) {
          getDb().run('DELETE FROM reactions WHERE message_id = ?', [messageId], () => {
            io.to(`channel_${row.channel_id}`).emit('message_deleted', { messageId });
          });
        }
      }
    );
  });

  socket.on('toggle_reaction', (data) => {
    const { messageId, emoji } = data || {};
    if (!Number.isInteger(messageId) || typeof emoji !== 'string' || !emoji.trim() || emoji.length > 32) return;
    if (!allowSocketEvent('toggle_reaction')) return;
    const userId = socket.data.user.id;

    // Membership check: the user must be a member of the server that owns the
    // channel of the message being reacted to. Closes vuln-0005.
    getDb().get(
      'SELECT 1 FROM messages m JOIN channels c ON c.id = m.channel_id JOIN server_members sm ON sm.server_id = c.server_id WHERE m.id = ? AND sm.user_id = ?',
      [messageId, userId],
      (aErr, allowed) => {
        if (aErr || !allowed) return;
        getDb().get(
          'SELECT id FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
          [messageId, userId, emoji],
          (err, existing) => {
            if (err) return;
            if (existing) {
              getDb().run('DELETE FROM reactions WHERE id = ?', [existing.id], () => {
                broadcastReactions(messageId);
              });
            } else {
              getDb().run('INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)', [messageId, userId, emoji], () => {
                broadcastReactions(messageId);
              });
            }
          }
        );
      }
    );
  });

  function broadcastReactions(messageId) {
    // One query retrieves both the room and individual reaction rows. This
    // avoids GROUP_CONCAT allocation/parsing and preserves an empty list once
    // the last reaction has been removed.
    getDb().all(
      `SELECT m.channel_id, r.emoji, r.user_id
       FROM messages m
       LEFT JOIN reactions r ON r.message_id = m.id
       WHERE m.id = ?`,
      [messageId],
      (err, rows) => {
        if (err || !rows?.length) return;
        const byEmoji = new Map();
        for (const row of rows) {
          if (!row.emoji) continue;
          const reaction = byEmoji.get(row.emoji) ?? { emoji: row.emoji, count: 0, userIds: [] };
          reaction.count += 1;
          reaction.userIds.push(Number(row.user_id));
          byEmoji.set(row.emoji, reaction);
        }
        io.to(`channel_${rows[0].channel_id}`).emit('reaction_updated', {
          messageId,
          reactions: Array.from(byEmoji.values()),
        });
      }
    );
  }

  socket.on('typing', (data) => {
    if (!data || !Number.isInteger(data.channelId)) return;
    if (!allowSocketEvent('typing')) return;
    const userId = socket.data.user.id;
    getDb().get(
      'SELECT 1 FROM channels c JOIN server_members sm ON sm.server_id = c.server_id WHERE c.id = ? AND sm.user_id = ?',
      [data.channelId, userId],
      (err, member) => {
        if (err || !member) return;
        socket.to(`channel_${data.channelId}`).emit('user_typing', {
          channelId: data.channelId,
          userId,
          username: socket.data.user.username,
        });
      }
    );
  });

  // WebRTC signaling and Voice Room management
  socket.on('join_voice', (data) => {
    const { channelId } = data || {};
    if (!Number.isInteger(channelId)) return;
    const userId = socket.data.user.id;





  // Look up the channel's server and the user's display info from the DB.
  // Client-supplied display fields are ignored; identity comes from the
  // authenticated user record. Membership is enforced here.
  getDb().get(
    'SELECT c.server_id, u.username, u.display_name, u.avatar FROM channels c, users u WHERE c.id = ? AND u.id = ?',
    [channelId, userId],
    (err, row) => {
      if (err || !row) return;
      getDb().get(
        'SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?',
        [row.server_id, userId],
        (mErr, member) => {
          if (mErr || !member) return;

          // A socket may emit join_voice more than once while Socket.IO is
          // reconnecting. Keep this idempotent: send a fresh snapshot to the
          // caller, but do not announce a second "user joined" event or make
          // the existing peers replace a healthy connection.
          const roomName = `voice_${channelId}`;
          if (!voiceChannels.has(channelId)) voiceChannels.set(channelId, new Map());
          const channelUsers = voiceChannels.get(channelId);
          const existingParticipant = channelUsers.get(userId);
          if (!existingParticipant && channelUsers.size >= MAX_VOICE_PARTICIPANTS) {
            socket.emit('voice_join_rejected', { channelId, reason: 'capacity_reached' });
            return;
          }
          if (existingParticipant?.socketId === socket.id) {
            const participants = Array.from(channelUsers.values());
            socket.emit('voice_participants', {
              channelId,
              participants,
              connectTo: participants
                .filter((participant) => participant.userId !== userId)
                .map((participant) => participant.socketId),
            });
            return;
          }

          // One socket belongs to only one voice room. This mostly protects
          // against an interrupted leave/join transition when switching
          // channels.
          const previousChannelId = getVoiceChannelId(socket.id);
          if (previousChannelId !== null && previousChannelId !== channelId) {
            const previousUsers = voiceChannels.get(previousChannelId);
            const previousParticipant = previousUsers?.get(userId);
            if (previousParticipant?.socketId === socket.id) {
              socket.leave(`voice_${previousChannelId}`);
              previousUsers.delete(userId);
              io.to(`voice_${previousChannelId}`).emit('user_left_voice', {
                channelId: previousChannelId,
                userId,
              });
              const remaining = previousUsers.size > 0 ? Array.from(previousUsers.values()) : [];
              io.to(`voice_${previousChannelId}`).emit('voice_participants', {
                channelId: previousChannelId,
                participants: remaining,
              });
              if (previousUsers.size === 0) voiceChannels.delete(previousChannelId);
            }
          }

          // A reconnect normally reaches the disconnect handler first. If a
          // second socket for the same user overlaps it, explicitly retire the
          // stale room membership so every peer closes the old PC before the
          // replacement socket is announced.
          if (existingParticipant) {
            for (const participant of channelUsers.values()) {
              if (participant.userId !== userId) {
                io.to(participant.socketId).emit('user_left_voice', { channelId, userId });
              }
            }
            io.sockets.sockets.get(existingParticipant.socketId)?.leave(roomName);
          }

          socket.join(roomName);
          // This arrives before voice_participants, so a joining client can
          // install optional TURN credentials before it creates peer offers.
          socket.emit('voice_ice_servers', { iceServers: getIceServers() });
          const participantInfo = {
            userId,
            socketId: socket.id,
            username: row.username,
            displayName: row.display_name || row.username,
            avatar: row.avatar,
            muted: false,
            speaking: false,
            deafened: false,
            screenSharing: false,
            screenStreamId: null,
            cameraOn: false,
          };
          channelUsers.set(userId, participantInfo);
          const participants = Array.from(channelUsers.values());
          // Only the newly joined client receives connectTo and becomes the
          // offerer for each pair. Broadcasting this to everyone causes WebRTC
          // offer glare because both peers create offers simultaneously.
          socket.emit('voice_participants', {
            channelId,
            participants,
            connectTo: participants
              .filter((participant) => participant.userId !== userId)
              .map((participant) => participant.socketId),
          });
          // Keep every client on one authoritative snapshot. Relying only on
          // the incremental user_joined_voice event left an existing client
          // stale if that single event was missed during a reconnect.
          io.to(roomName).emit('voice_participants', { channelId, participants });
          socket.to(roomName).emit('user_joined_voice', { channelId, participant: participantInfo });
        }
      );
    }
  );
});
  socket.on('leave_voice', (data) => {
    const { channelId } = data || {};
    if (!Number.isInteger(channelId)) return;
    const userId = socket.data.user.id;
    const channelUsers = voiceChannels.get(channelId);
    const participant = channelUsers?.get(userId);
    if (!participant || participant.socketId !== socket.id) return;
    socket.leave(`voice_${channelId}`);

    channelUsers.delete(userId);
    if (channelUsers.size === 0) {
      voiceChannels.delete(channelId);
    }

    io.to(`voice_${channelId}`).emit('user_left_voice', { channelId, userId });
    const remaining = voiceChannels.has(channelId) ? Array.from(voiceChannels.get(channelId).values()) : [];
    io.to(`voice_${channelId}`).emit('voice_participants', { channelId, participants: remaining });
  });

  // Helper: find which voice channel (if any) a given socketId is currently
  // a participant of. Returns the channelId or null.
  function getVoiceChannelId(socketId) {
    for (const [channelId, channelUsers] of voiceChannels.entries()) {
      for (const [, p] of channelUsers) {
        if (p.socketId === socketId) return channelId;
      }
    }
    return null;
  }

  function isSocketInVoiceChannel(socketId, channelId, userId) {
    const participant = voiceChannels.get(channelId)?.get(userId);
    return participant?.socketId === socketId;
  }

  // WebRTC signaling handlers. Each handler validates that BOTH the sender
  // and the target are members of the same voice channel. Without this, a
  // member of the server who is in channel A could send signaling to a member
  // in channel B, which is a horizontal-privilege-escalation bug (Cenário B
  // in the pentest). Non-members are already blocked at join_voice, so any
  // socket reaching here is a server member — but channel membership still
  // must be verified.
  socket.on('webrtc_offer', (data) => {
    if (!allowSocketEvent('webrtc_offer')) return;
    if (!data || typeof data.to !== 'string') return;
    const senderCh = getVoiceChannelId(socket.id);
    if (!senderCh) return; // sender not in any voice channel
    if (!voiceChannels.has(senderCh)) return;
    const targetCh = getVoiceChannelId(data.to);
    if (targetCh !== senderCh) return; // target in different/no channel
    socket.to(data.to).emit('webrtc_offer', { offer: data.offer, from: socket.id, fromUserId: socket.userId });
  });

  socket.on('webrtc_answer', (data) => {
    if (!allowSocketEvent('webrtc_answer')) return;
    if (!data || typeof data.to !== 'string') return;
    const senderCh = getVoiceChannelId(socket.id);
    if (!senderCh) return;
    if (!voiceChannels.has(senderCh)) return;
    const targetCh = getVoiceChannelId(data.to);
    if (targetCh !== senderCh) return;
    socket.to(data.to).emit('webrtc_answer', { answer: data.answer, from: socket.id, fromUserId: socket.userId });
  });

  socket.on('webrtc_ice_candidate', (data) => {
    if (!allowSocketEvent('webrtc_ice_candidate')) return;
    if (!data || typeof data.to !== 'string') return;
    const senderCh = getVoiceChannelId(socket.id);
    if (!senderCh) return;
    if (!voiceChannels.has(senderCh)) return;
    const targetCh = getVoiceChannelId(data.to);
    if (targetCh !== senderCh) return;
    socket.to(data.to).emit('webrtc_ice_candidate', { candidate: data.candidate, from: socket.id, fromUserId: socket.userId });
  });

  socket.on('toggle_mute', (data) => {
    const { channelId, muted } = data || {};
    if (!Number.isInteger(channelId) || typeof muted !== 'boolean') return;
    const userId = socket.data.user.id;
    if (!isSocketInVoiceChannel(socket.id, channelId, userId)) return;
    if (voiceChannels.has(channelId)) {
      const p = voiceChannels.get(channelId).get(userId);
      if (p) {
        p.muted = muted;
        if (muted) p.speaking = false;
      }
    }
    io.to(`voice_${channelId}`).emit('user_muted', { channelId, userId, muted });
    if (muted) io.to(`voice_${channelId}`).emit('user_speaking', { channelId, userId, speaking: false });
  });

  // Voice activity is calculated locally from the microphone level. The
  // server only validates room membership and relays transitions, keeping all
  // clients in the call synchronized without ever receiving audio media.
  socket.on('speaking_state', (data) => {
    const { channelId, speaking } = data || {};
    if (!Number.isInteger(channelId) || typeof speaking !== 'boolean') return;
    const userId = socket.data.user.id;
    if (!isSocketInVoiceChannel(socket.id, channelId, userId)) return;
    const participant = voiceChannels.get(channelId)?.get(userId);
    if (!participant) return;
    const nextSpeaking = participant.muted ? false : speaking;
    if (participant.speaking === nextSpeaking) return;
    participant.speaking = nextSpeaking;
    io.to(`voice_${channelId}`).emit('user_speaking', { channelId, userId, speaking: nextSpeaking });
  });

  socket.on('toggle_deafen', (data) => {
    const { channelId, deafened } = data || {};
    if (!Number.isInteger(channelId) || typeof deafened !== 'boolean') return;
    const userId = socket.data.user.id;
    if (!isSocketInVoiceChannel(socket.id, channelId, userId)) return;
    if (voiceChannels.has(channelId)) {
      const p = voiceChannels.get(channelId).get(userId);
      if (p) p.deafened = deafened;
    }
    io.to(`voice_${channelId}`).emit('user_deafened', { channelId, userId, deafened });
  });

  socket.on('start_screen_share', (data) => {
    const { channelId, streamId } = data || {};
    if (!Number.isInteger(channelId) || typeof streamId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(streamId)) return;
    const userId = socket.data.user.id;
    if (!isSocketInVoiceChannel(socket.id, channelId, userId)) return;
    if (voiceChannels.has(channelId)) {
      const p = voiceChannels.get(channelId).get(userId);
      if (p) {
        p.screenSharing = true;
        p.screenStreamId = streamId;
      }
    }
    io.to(`voice_${channelId}`).emit('user_screen_share_started', { channelId, userId, streamId });
  });

  socket.on('stop_screen_share', (data) => {
    const { channelId } = data || {};
    if (!Number.isInteger(channelId)) return;
    const userId = socket.data.user.id;
    if (!isSocketInVoiceChannel(socket.id, channelId, userId)) return;
    if (voiceChannels.has(channelId)) {
      const p = voiceChannels.get(channelId).get(userId);
      if (p) {
        p.screenSharing = false;
        p.screenStreamId = null;
      }
    }
    io.to(`voice_${channelId}`).emit('user_screen_share_stopped', { channelId, userId });
  });

  socket.on('toggle_camera', (data) => {
    const { channelId, cameraOn } = data || {};
    if (!Number.isInteger(channelId) || typeof cameraOn !== 'boolean') return;
    const userId = socket.data.user.id;
    if (!isSocketInVoiceChannel(socket.id, channelId, userId)) return;
    if (voiceChannels.has(channelId)) {
      const p = voiceChannels.get(channelId).get(userId);
      if (p) p.cameraOn = cameraOn;
    }
    io.to(`voice_${channelId}`).emit('user_camera_toggled', { channelId, userId, cameraOn });
  });

  // Direct messages — senderId is ALWAYS derived from socket.data.user.id.
  socket.on('send_dm', (data, ack) => {
    const { receiverId, content } = data || {};
    const senderId = socket.data.user.id;
    const respond = (payload) => {
      if (typeof ack === 'function') {
        try { ack(payload); } catch { /* ignore */ }
      }
      if (payload?.error) socket.emit('dm_error', { error: payload.error });
      if (payload?.success) socket.emit('dm_sent', { message: payload.message });
    };
    if (!Number.isInteger(receiverId) || typeof content !== 'string' || !content.trim() || content.length > MAX_DM_LENGTH) {
      respond({ error: 'Conteúdo inválido' });
      return;
    }
    if (!allowSocketEvent('send_dm')) {
      respond({ error: 'Muitas mensagens. Aguarde.' });
      return;
    }
    if (receiverId === senderId) {
      respond({ error: 'Não pode enviar para si mesmo' });
      return;
    }
    getDb().get(
      `SELECT 1 FROM friends
       WHERE status = 'accepted'
       AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))`,
      [senderId, receiverId, receiverId, senderId],
      (relationshipError, friendship) => {
        if (relationshipError || !friendship) {
          respond({ error: 'Amizade necessária para enviar DM' });
          return;
        }
        getDb().run(
      'INSERT INTO direct_messages (sender_id, receiver_id, content) VALUES (?, ?, ?)',
      [senderId, receiverId, content.trim()],
      function(err) {
        if (err) {
          respond({ error: 'Falha ao salvar mensagem' });
          return;
        }
        const dmId = this.lastID;
        getDb().get(
          `SELECT dm.*, u.username, u.display_name, u.avatar
           FROM direct_messages dm JOIN users u ON dm.sender_id = u.id WHERE dm.id = ?`,
          [dmId],
          (gErr, row) => {
            if (gErr || !row) {
              respond({ error: 'Falha ao carregar mensagem' });
              return;
            }
            io.to(`user_${receiverId}`).emit('new_dm', row);
            socket.emit('new_dm', row);
            respond({ success: true, message: row });
          }
        );
      }
        );
      }
    );
  });

  socket.on('update_status', (data) => {
    const { status } = data || {};
    if (!['online', 'idle', 'dnd', 'invisible'].includes(status)) return;
    const userId = socket.data.user.id;
    getDb().run('UPDATE users SET status = ? WHERE id = ?', [status, userId], () => {
      const effective = getEffectiveStatus(status);
      broadcastPresenceToFriends(userId, effective);
      // Sync to own other devices as well
      io.to(`user_${userId}`).emit('user_status', { userId, status: effective });
    });
  });

  socket.on('disconnect', () => {
    const userId = socket.data.user?.id;
    if (userId) {
      const set = activeSocketsByUser.get(userId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          activeSocketsByUser.delete(userId);
          // Grace period to handle quick reconnections without flicker
          const timer = setTimeout(() => {
            pendingOfflineTimers.delete(userId);
            // Only mark offline if still no socket after grace
            if (activeSocketsByUser.has(userId)) return;
            getDb().get('SELECT status FROM users WHERE id = ?', [userId], (gErr, row) => {
              const dbStatus = row?.status;
              if (dbStatus === 'invisible') {
                // Keep invisible preference, but ensure friends see offline (already)
                broadcastPresenceToFriends(userId, 'offline');
                return;
              }
              getDb().run('UPDATE users SET status = ? WHERE id = ?', ['offline', userId], () => {
                broadcastPresenceToFriends(userId, 'offline');
              });
            });
          }, 2500);
          pendingOfflineTimers.set(userId, timer);
        }
      }
    }

    // Remove from voice channels
    for (const [channelId, channelUsers] of voiceChannels.entries()) {
      for (const [userId, participant] of channelUsers.entries()) {
        if (participant.socketId === socket.id) {
          channelUsers.delete(userId);
          io.to(`voice_${channelId}`).emit('user_left_voice', { channelId, userId });
          const remaining = Array.from(channelUsers.values());
          io.to(`voice_${channelId}`).emit('voice_participants', { channelId, participants: remaining });
          break;
        }
      }
      if (channelUsers.size === 0) {
        voiceChannels.delete(channelId);
      }
    }

    console.log('User disconnected:', socket.id);
  });
});

httpServer.listen(PORT, HOST, () => {
  console.log(`Discord 2 Server running on port ${PORT}`);
  console.log(`Discord 2 Server bound to ${HOST}`);
});

export { io, UPLOADS_DIR };
