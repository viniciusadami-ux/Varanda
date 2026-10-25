import sqlite3 from 'sqlite3';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(__dirname, '../../database/varanda.db');
const DATABASE_PATH = process.env.DATABASE_PATH || DEFAULT_DB_PATH;
mkdirSync(dirname(DATABASE_PATH), { recursive: true });

const db = new sqlite3.Database(DATABASE_PATH);

export function initDatabase() {
  db.serialize(() => {
    db.run(`PRAGMA foreign_keys = ON`);
    db.run(`PRAGMA journal_mode = WAL`);
    // Users
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      avatar TEXT,
      status TEXT DEFAULT 'offline',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Servers
    db.run(`CREATE TABLE IF NOT EXISTS servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT,
      owner_id INTEGER NOT NULL,
      invite_code TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    )`);

    // Server Members
    db.run(`CREATE TABLE IF NOT EXISTS server_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(server_id, user_id),
      FOREIGN KEY (server_id) REFERENCES servers(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // Categories
    db.run(`CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      position INTEGER DEFAULT 0,
      FOREIGN KEY (server_id) REFERENCES servers(id)
    )`);

    // Channels
    db.run(`CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER NOT NULL,
      category_id INTEGER,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'text',
      position INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (server_id) REFERENCES servers(id),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    )`);

    // Messages
    db.run(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      reply_to INTEGER,
      file_url TEXT,
      file_name TEXT,
      file_type TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (channel_id) REFERENCES channels(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // Friends
    db.run(`CREATE TABLE IF NOT EXISTS friends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(sender_id, receiver_id),
      FOREIGN KEY (sender_id) REFERENCES users(id),
      FOREIGN KEY (receiver_id) REFERENCES users(id)
    )`);

    // Invites
    db.run(`CREATE TABLE IF NOT EXISTS invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER NOT NULL,
      code TEXT UNIQUE NOT NULL,
      created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (server_id) REFERENCES servers(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    )`);

    // Direct Messages
    db.run(`CREATE TABLE IF NOT EXISTS direct_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sender_id) REFERENCES users(id),
      FOREIGN KEY (receiver_id) REFERENCES users(id)
    )`);

    // Reactions
    db.run(`CREATE TABLE IF NOT EXISTS reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      emoji TEXT NOT NULL,
      UNIQUE(message_id, user_id, emoji),
      FOREIGN KEY (message_id) REFERENCES messages(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // Query paths used by message history, DMs, friend lists and reactions.
    // IF NOT EXISTS keeps this migration safe for existing installations.
    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_channel_created_at
      ON messages(channel_id, created_at DESC, id DESC)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_direct_messages_participants_created_at
      ON direct_messages(sender_id, receiver_id, created_at DESC, id DESC)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_direct_messages_reverse_participants_created_at
      ON direct_messages(receiver_id, sender_id, created_at DESC, id DESC)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_friends_receiver_status
      ON friends(receiver_id, status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_reactions_message
      ON reactions(message_id)`);
  });
}

export function getDb() {
  return db;
}

export default db;
