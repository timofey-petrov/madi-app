import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outboxDir = path.join(__dirname, 'data', 'outbox');
if (!fs.existsSync(outboxDir)) fs.mkdirSync(outboxDir, { recursive: true });

function hasSmtp() {
  return !!process.env.SMTP_HOST && !!process.env.SMTP_USER && !!process.env.SMTP_PASS;
}

let transporter = null;
if (hasSmtp()) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

export async function sendEmail({ to, subject, text, html }) {
  const from = process.env.SMTP_FROM || 'MADI App <no-reply@madi.local>';
  if (transporter) {
    await transporter.sendMail({ from, to, subject, text, html });
    return;
  }
  const file = path.join(outboxDir, `${Date.now()}_${(to||'unknown').replace(/[^a-zA-Z0-9_.-]/g,'_')}.txt`);
  const content = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    '',
    html || text || ''
  ].join('\n');
  fs.writeFileSync(file, content, 'utf8');
  try { console.log('Email written to outbox:', file); } catch {}
}
