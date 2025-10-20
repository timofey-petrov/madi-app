import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import db from './db.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const dataPath = path.join(__dirname, 'data', 'madi.db');
const uploadsDir = path.join(__dirname, 'uploads');

// Wipe tables
db.exec('PRAGMA foreign_keys = OFF');
db.exec(`
DELETE FROM submissions;
DELETE FROM assignments;
DELETE FROM messages;
DELETE FROM chat_members;
DELETE FROM password_resets;
DELETE FROM schedule_events;
DELETE FROM chats;
DELETE FROM users;
`);
db.exec('PRAGMA foreign_keys = ON');

// Clear uploads
if (fs.existsSync(uploadsDir)) {
  for (const f of fs.readdirSync(uploadsDir)) {
    const p = path.join(uploadsDir, f);
    try { fs.unlinkSync(p); } catch {}
  }
}

function now(){ return Date.now(); }
function addUser(email, name, password, role='student'){
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(email, hash, name, role, now());
  return { id: info.lastInsertRowid, email, name, role };
}

const teacher = addUser('teacher@madi.ru','Преподаватель','password','teacher');
const student = addUser('student@madi.ru','Студент','password','student');

// Create demo chat
const room = `MADI_RESET_${Date.now()}`;
const chatInfo = db.prepare('INSERT INTO chats (title, is_group, owner_id, jitsi_room, created_at) VALUES (?, 1, ?, ?, ?)')
  .run('Тестовая группа', teacher.id, room, now());
const chatId = chatInfo.lastInsertRowid;
db.prepare('INSERT INTO chat_members (chat_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').run(chatId, teacher.id, 'owner', now());
db.prepare('INSERT INTO chat_members (chat_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').run(chatId, student.id, 'member', now());
db.prepare("INSERT INTO messages (chat_id, user_id, content, type, created_at) VALUES (?, ?, ?, 'text', ?)").run(chatId, teacher.id, 'Добро пожаловать!', now());
db.prepare("INSERT INTO messages (chat_id, user_id, content, type, created_at) VALUES (?, ?, ?, 'text', ?)").run(chatId, student.id, 'Спасибо!', now());

// 3 assignments
for (let i=1;i<=3;i++){
  db.prepare("INSERT INTO assignments (chat_id, title, description, due_at, creator_id, created_at, status) VALUES (?, ?, ?, ?, ?, ?, 'open')")
    .run(chatId, `Задание ${i}`, `Описание ${i}`, now()+i*86400000, teacher.id, now());
}

// Schedule sample
const start = new Date(); start.setHours(10,0,0,0);
db.prepare('INSERT INTO schedule_events (group_name, title, starts_at, ends_at, location, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run('ИВЧ-21','Лекция', start.getTime(), start.getTime()+90*60000, 'А-101', 'План занятия', now());

console.log('Reset complete. Users: teacher@madi.ru/password, student@madi.ru/password');
