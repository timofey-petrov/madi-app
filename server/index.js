import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { Server } from 'socket.io';
import db from './db.js';
import { sendEmail } from './email.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Static files
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const webDist = path.join(__dirname, '..', 'web', 'dist');
const hasWebApp = fs.existsSync(webDist);

// Redirect legacy HTML entrypoints before static middleware
const legacyPaths = ['/chats.html', '/chat.html', '/teams.html', '/teams'];
app.use((req, res, next) => {
  if (legacyPaths.includes(req.path)) {
    return res.redirect(301, '/chats');
  }
  next();
});

if (hasWebApp) {
  app.use(express.static(webDist));
} else {
  app.use(express.static(publicDir));
}
app.use('/uploads', express.static(uploadDir)); // Note: open for MVP

// Multer config
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const ts = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, `${ts}_${safeName}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB

// Helpers
function now() { return Date.now(); }

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role || 'student' }, JWT_SECRET, { expiresIn: '7d' });
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function isMember(chatId, userId) {
  const row = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
  return !!row;
}

function memberRole(chatId, userId) {
  const row = db.prepare('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
  return row?.role || null;
}

function requireRole(roles) {
  return (req, res, next) => {
    const { chatId } = req.params;
    const role = memberRole(chatId, req.user.id);
    if (!role) return res.status(403).json({ error: 'Not a member' });
    if (!roles.includes(role) && role !== 'owner') return res.status(403).json({ error: 'Insufficient role' });
    next();
  };
}

// Auth
app.post('/api/auth/register', (req, res) => {
  const { email, password, name, role } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: 'Missing fields' });
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return res.status(409).json({ error: 'Email in use' });
  const hash = bcrypt.hashSync(password, 10);
  const userRole = (role === 'teacher') ? 'teacher' : 'student';
  const info = db.prepare('INSERT INTO users (email, password_hash, name, created_at, role) VALUES (?, ?, ?, ?, ?)')
    .run(email, hash, name, now(), userRole);
  const user = { id: info.lastInsertRowid, email, name, role: userRole };
  res.json({ user, token: signToken(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role || 'student' }, token: signToken(user) });
});

app.get('/api/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(req.user.id);
  res.json({ user });
});

// Change password (auth)
app.post('/api/auth/change-password', auth, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Missing fields' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current_password, user.password_hash)) return res.status(400).json({ error: 'Текущий пароль неверен' });
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ ok: true });
});

// Password reset endpoints removed as requested

// Users search (invite helper)
app.get('/api/users', auth, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ users: [] });
  const like = `%${q.replace(/%/g, '')}%`;
  const rows = db.prepare('SELECT id, name, email FROM users WHERE email LIKE ? OR name LIKE ? LIMIT 10').all(like, like);
  res.json({ users: rows });
});

// Chats
app.post('/api/chats', auth, (req, res) => {
  const { title, memberIds = [], is_group = 1 } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  const isGroup = Number(is_group) ? 1 : 0;
  const jitsiRoom = `MADI_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const info = db.prepare('INSERT INTO chats (title, is_group, owner_id, jitsi_room, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(title, isGroup, req.user.id, jitsiRoom, now());
  const chatId = info.lastInsertRowid;
  db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, created_at) VALUES (?, ?, ?, ?)')
    .run(chatId, req.user.id, 'owner', now());
  const addMember = db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, created_at) VALUES (?, ?, ?, ?)');
  for (const uid of memberIds) {
    if (uid === req.user.id) continue;
    addMember.run(chatId, uid, 'member', now());
  }
  res.json({ id: chatId, title, jitsi_room: jitsiRoom });
});

app.get('/api/chats', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.title, c.created_at,
      (SELECT content FROM messages m WHERE m.chat_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
    FROM chats c
    JOIN chat_members cm ON cm.chat_id = c.id
    WHERE cm.user_id = ?
    ORDER BY c.created_at DESC
  `).all(req.user.id);
  res.json({ chats: rows });
});

// Chat meta
app.get('/api/chats/:chatId', auth, (req, res) => {
  const { chatId } = req.params;
  if (!isMember(chatId, req.user.id)) return res.status(403).json({ error: 'Not a member' });
  const chat = db.prepare('SELECT id, title, jitsi_room FROM chats WHERE id = ?').get(chatId);
  res.json(chat);
});

// Rename chat (owner only)
app.put('/api/chats/:chatId', auth, (req, res) => {
  const { chatId } = req.params;
  const { title } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Title required' });
  const role = memberRole(chatId, req.user.id);
  if (role !== 'owner') return res.status(403).json({ error: 'Forbidden' });
  db.prepare('UPDATE chats SET title = ? WHERE id = ?').run(title, chatId);
  res.json({ ok: true });
});

app.get('/api/chats/:chatId/members', auth, (req, res) => {
  if (!isMember(req.params.chatId, req.user.id)) return res.status(403).json({ error: 'Not a member' });
  const rows = db.prepare('SELECT u.id, u.name, u.email, cm.role FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ?')
    .all(req.params.chatId);
  res.json({ members: rows });
});

app.post('/api/chats/:chatId/members', auth, requireRole(['owner', 'moderator']), (req, res) => {
  const { userId, role = 'member' } = req.body;
  const { chatId } = req.params;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  db.prepare(`
    INSERT INTO chat_members (chat_id, user_id, role, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(chat_id, user_id) DO UPDATE SET role = excluded.role
  `).run(chatId, userId, role, now());
  res.json({ ok: true });
});

app.delete('/api/chats/:chatId/members/:userId', auth, requireRole(['owner', 'moderator']), (req, res) => {
  const { chatId, userId } = req.params;
  const target = db.prepare('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
  if (!target) return res.status(404).json({ error: 'Not in chat' });
  if (target.role === 'owner') return res.status(400).json({ error: 'Cannot remove owner' });
  db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run(chatId, userId);
  res.json({ ok: true });
});

app.get('/api/chats/:chatId/messages', auth, (req, res) => {
  const { chatId } = req.params;
  if (!isMember(chatId, req.user.id)) return res.status(403).json({ error: 'Not a member' });
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const rows = db.prepare('SELECT m.*, u.name as user_name FROM messages m JOIN users u ON u.id = m.user_id WHERE m.chat_id = ? ORDER BY m.created_at DESC LIMIT ?')
    .all(chatId, limit)
    .reverse();
  res.json({ messages: rows });
});

app.post('/api/chats/:chatId/messages', auth, upload.single('file'), (req, res) => {
  const { chatId } = req.params;
  if (!isMember(chatId, req.user.id)) return res.status(403).json({ error: 'Not a member' });
  const content = req.body.content || '';
  let type = 'text';
  let attachment_path = null;
  let attachment_name = null;
  if (req.file) {
    attachment_path = `/uploads/${req.file.filename}`;
    attachment_name = req.file.originalname;
    if ((req.file.mimetype || '').startsWith('video/')) type = 'video';
    else type = 'file';
  }
  if (!content && !attachment_path) return res.status(400).json({ error: 'Empty message' });

  const info = db.prepare('INSERT INTO messages (chat_id, user_id, content, type, attachment_path, attachment_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(chatId, req.user.id, content, type, attachment_path, attachment_name, now());
  const msg = db.prepare('SELECT m.*, u.name as user_name FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?').get(info.lastInsertRowid);
  io.to(`chat_${chatId}`).emit('message', msg);
  res.json({ message: msg });
});

// Edit message (text only)
app.put('/api/chats/:chatId/messages/:messageId', auth, (req, res) => {
  const { chatId, messageId } = req.params;
  const { content } = req.body || {};
  if (!isMember(chatId, req.user.id)) return res.status(403).json({ error: 'Not a member' });
  const m = db.prepare('SELECT * FROM messages WHERE id = ? AND chat_id = ?').get(messageId, chatId);
  if (!m) return res.status(404).json({ error: 'Not found' });
  const role = memberRole(chatId, req.user.id) || 'member';
  if (m.user_id !== req.user.id && !(role === 'owner' || role === 'moderator')) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(content || '', messageId);
  const updated = db.prepare('SELECT m.*, u.name as user_name FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?').get(messageId);
  io.to(`chat_${chatId}`).emit('message_updated', updated);
  res.json({ message: updated });
});
app.delete('/api/chats/:chatId/messages/:messageId', auth, (req, res) => {
  const { chatId, messageId } = req.params;
  if (!isMember(chatId, req.user.id)) return res.status(403).json({ error: 'Not a member' });
  const m = db.prepare('SELECT * FROM messages WHERE id = ? AND chat_id = ?').get(messageId, chatId);
  if (!m) return res.status(404).json({ error: 'Not found' });
  const role = memberRole(chatId, req.user.id) || 'member';
  if (m.user_id !== req.user.id && !(role === 'owner' || role === 'moderator')) return res.status(403).json({ error: 'Forbidden' });
  if (m.attachment_path) {
    try{
      const fileName = path.basename(m.attachment_path);
      const filePath = path.join(uploadDir, fileName);
      if (filePath.startsWith(uploadDir)) fs.unlinkSync(filePath);
    }catch{}
  }
  db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
  io.to(`chat_${chatId}`).emit('message_deleted', { id: Number(messageId) });
  res.json({ ok: true });
});

app.get('/api/chats/:chatId/jitsi', auth, (req, res) => {
  const { chatId } = req.params;
  if (!isMember(chatId, req.user.id)) return res.status(403).json({ error: 'Not a member' });
  const chat = db.prepare('SELECT jitsi_room, title FROM chats WHERE id = ?').get(chatId);
  const url = `https://meet.jit.si/${encodeURIComponent(chat.jitsi_room)}`;
  res.json({ title: chat.title, url });
});

// Assignments
// Allow owners/moderators or any teacher who is a member
app.post('/api/chats/:chatId/assignments', auth, (req, res) => {
  const { chatId } = req.params;
  const { title, description, due_at } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  const member = isMember(chatId, req.user.id);
  if (!member) return res.status(403).json({ error: 'Not a member' });
  const r = memberRole(chatId, req.user.id) || 'member';
  const u = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id);
  if (!(r === 'owner' || r === 'moderator' || (u?.role === 'teacher'))) return res.status(403).json({ error: 'Forbidden' });
  const info = db.prepare('INSERT INTO assignments (chat_id, title, description, due_at, creator_id, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(chatId, title, description || '', due_at ? Number(due_at) : null, req.user.id, now(), 'open');
  // Keep only latest 3 per chat
  db.prepare(`DELETE FROM assignments WHERE chat_id = ? AND id NOT IN (
    SELECT id FROM assignments WHERE chat_id = ? ORDER BY created_at DESC LIMIT 3
  )`).run(chatId, chatId);
  res.json({ id: info.lastInsertRowid, title, description, due_at });
});

app.get('/api/chats/:chatId/assignments', auth, (req, res) => {
  const { chatId } = req.params;
  if (!isMember(chatId, req.user.id)) return res.status(403).json({ error: 'Not a member' });
  const rows = db.prepare('SELECT * FROM assignments WHERE chat_id = ? ORDER BY created_at DESC LIMIT 3').all(chatId);
  res.json({ assignments: rows });
});

// Close assignment
app.post('/api/assignments/:assignmentId/close', auth, (req, res) => {
  const { assignmentId } = req.params;
  const a = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId);
  if (!a) return res.status(404).json({ error: 'Not found' });
  // Check role in related chat
  const role = memberRole(a.chat_id, req.user.id);
  if (!role || (role !== 'owner' && role !== 'moderator')) return res.status(403).json({ error: 'Forbidden' });
  db.prepare("UPDATE assignments SET status = 'closed' WHERE id = ?").run(assignmentId);
  res.json({ ok: true });
});

app.post('/api/assignments/:assignmentId/submissions', auth, upload.single('file'), (req, res) => {
  const { assignmentId } = req.params;
  if (!req.file) return res.status(400).json({ error: 'File required' });
  const file_path = `/uploads/${req.file.filename}`;
  const file_name = req.file.originalname;
  const info = db.prepare('INSERT INTO submissions (assignment_id, user_id, file_path, file_name, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(assignmentId, req.user.id, file_path, file_name, now());
  res.json({ id: info.lastInsertRowid, file_path, file_name });
});

app.get('/api/assignments/:assignmentId/submissions', auth, (req, res) => {
  const { assignmentId } = req.params;
  const rows = db.prepare('SELECT * FROM submissions WHERE assignment_id = ? ORDER BY created_at DESC').all(assignmentId);
  res.json({ submissions: rows });
});

// Schedule
app.post('/api/schedule', auth, (req, res) => {
  const { group_name, title, starts_at, ends_at, location, notes } = req.body;
  const u = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id);
  if (u?.role !== 'teacher') return res.status(403).json({ error: 'Only teachers can add events' });
  if (!title || !starts_at) return res.status(400).json({ error: 'Missing fields' });
  const start = Number(starts_at);
  const end = Number(ends_at || starts_at);
  const info = db.prepare('INSERT INTO schedule_events (group_name, course, title, starts_at, ends_at, location, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(group_name || null, null, title, start, end, location || null, notes || null, now());
  res.json({ id: info.lastInsertRowid });
});

app.get('/api/schedule', auth, (req, res) => {
  const { group } = req.query;
  let sql = 'SELECT * FROM schedule_events';
  const cond = [];
  const params = [];
  if (group) { cond.push('group_name = ?'); params.push(group); }
  if (cond.length) sql += ' WHERE ' + cond.join(' AND ');
  sql += ' ORDER BY starts_at ASC';
  const rows = db.prepare(sql).all(...params);
  res.json({ events: rows });
});

// Socket.io
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.headers['x-token'];
    if (!token) return next(new Error('no token'));
    const user = jwt.verify(token, JWT_SECRET);
    socket.user = user;
    next();
  } catch (e) {
    next(e);
  }
});

io.on('connection', (socket) => {
  socket.on('join', ({ chatId }) => {
    if (!chatId) return;
    if (!isMember(chatId, socket.user.id)) return;
    socket.join(`chat_${chatId}`);
  });
  socket.on('typing', ({ chatId }) => {
    if (!chatId) return;
    if (!isMember(chatId, socket.user.id)) return;
    io.to(`chat_${chatId}`).emit('typing', { chatId, user_id: socket.user.id, user_name: socket.user.name, at: Date.now() });
  });
});

// Delete chat (owner only)
app.delete('/api/chats/:chatId', auth, (req, res) => {
  const { chatId } = req.params;
  const role = memberRole(chatId, req.user.id);
  if (role !== 'owner') return res.status(403).json({ error: 'Forbidden' });
  // Delete attachments files
  const attachments = db.prepare('SELECT attachment_path FROM messages WHERE chat_id = ? AND attachment_path IS NOT NULL').all(chatId);
  for (const a of attachments) {
    try {
      const name = path.basename(a.attachment_path);
      const p = path.join(uploadDir, name);
      if (p.startsWith(uploadDir) && fs.existsSync(p)) fs.unlinkSync(p);
    } catch {}
  }
  db.prepare('DELETE FROM submissions WHERE assignment_id IN (SELECT id FROM assignments WHERE chat_id = ?)').run(chatId);
  db.prepare('DELETE FROM assignments WHERE chat_id = ?').run(chatId);
  db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chatId);
  db.prepare('DELETE FROM chat_members WHERE chat_id = ?').run(chatId);
  db.prepare('DELETE FROM chats WHERE id = ?').run(chatId);
  res.json({ ok: true });
});

// Fallback to SPA entry
if (hasWebApp) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(webDist, 'index.html'));
  });
} else {
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

// Error handler with friendlier messages
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Файл слишком большой. Лимит 100 МБ.' });
  }
  if (err && err.message) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

server.listen(PORT, () => {
  console.log(`MADI MVP server running on http://localhost:${PORT}`);
});
