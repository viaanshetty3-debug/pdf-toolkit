// Password hashing (scrypt via node:crypto) + session cookie middleware.

import crypto from 'node:crypto';
import { db } from './db.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days
const COOKIE_NAME = 'pdftk_session';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, now, now + SESSION_TTL_MS);
  return token;
}

export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function getUserFromToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.email, s.expires_at
    FROM sessions s JOIN users u ON s.user_id = u.id
    WHERE s.token = ?
  `).get(token);
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, email: row.email };
}

export function parseCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === name) return v;
  }
  return null;
}

export function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`);
}

/**
 * Express middleware that attaches `req.user` if an auth cookie / API key is
 * present. Never blocks the request — tools remain usable anonymously.
 */
export function authMiddleware(req, res, next) {
  // Session cookie.
  const token = parseCookie(req, COOKIE_NAME);
  const sessUser = getUserFromToken(token);
  if (sessUser) { req.user = sessUser; return next(); }

  // Bearer API key.
  const auth = req.headers.authorization || '';
  const bearer = auth.match(/^Bearer\s+(.+)/i);
  if (bearer) {
    const key = bearer[1].trim();
    const row = db.prepare(`
      SELECT u.id, u.email FROM api_keys k JOIN users u ON k.user_id = u.id WHERE k.key = ?
    `).get(key);
    if (row) req.user = { id: row.id, email: row.email, viaApiKey: true };
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
}

export { COOKIE_NAME };
