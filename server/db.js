import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'madi.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

// Initialize schema (idempotent)
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  is_group INTEGER NOT NULL DEFAULT 1,
  owner_id INTEGER NOT NULL,
  jitsi_room TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', -- owner | moderator | member
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, user_id),
  FOREIGN KEY(chat_id) REFERENCES chats(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  content TEXT,
  type TEXT NOT NULL DEFAULT 'text', -- text | file | video
  attachment_path TEXT,
  attachment_name TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(chat_id) REFERENCES chats(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_at INTEGER,
  creator_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(chat_id) REFERENCES chats(id),
  FOREIGN KEY(creator_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(assignment_id) REFERENCES assignments(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS schedule_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_name TEXT,
  course TEXT,
  title TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  location TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

export default db;

// Lightweight migration: add assignments.status if missing
try {
  const col = db.prepare("SELECT name FROM pragma_table_info('assignments') WHERE name='status'").get();
  if (!col) {
    db.prepare("ALTER TABLE assignments ADD COLUMN status TEXT").run();
    db.prepare("UPDATE assignments SET status = 'open' WHERE status IS NULL").run();
  }
} catch {}

// Add users.role if missing (student|teacher)
try {
  const col = db.prepare("SELECT name FROM pragma_table_info('users') WHERE name='role'").get();
  if (!col) {
    db.prepare("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'student'").run();
    db.prepare("UPDATE users SET role = 'student' WHERE role IS NULL").run();
  }
} catch {}
