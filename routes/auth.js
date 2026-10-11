import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../lib/db.js';
import {
  hashPassword, verifyPassword, createSession, destroySession,
  setSessionCookie, clearSessionCookie, parseCookie, COOKIE_NAME,
  requireAuth,
} from '../lib/auth.js';
import { httpError } from '../lib/pdf-utils.js';

const router = Router();

router.post('/register', (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) throw httpError(400, 'Valid email required');
    if (password.length < 8) throw httpError(400, 'Password must be at least 8 characters');
    const existing = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
    if (existing) throw httpError(409, 'An account with that email already exists');
    const now = Date.now();
    const result = db.prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)')
      .run(email, hashPassword(password), now);
    const token = createSession(result.lastInsertRowid);
    setSessionCookie(res, token);
    res.json({ email });
  } catch (e) { next(e); }
});

router.post('/login', (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const row = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email);
    if (!row || !verifyPassword(password, row.password_hash)) throw httpError(401, 'Invalid credentials');
    const token = createSession(row.id);
    setSessionCookie(res, token);
    res.json({ email });
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => {
  const token = parseCookie(req, COOKIE_NAME);
  destroySession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ email: req.user.email, viaApiKey: !!req.user.viaApiKey });
});

// API key management.
router.get('/keys', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT key, label, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  res.json({ keys: rows });
});

router.post('/keys', requireAuth, (req, res) => {
  const label = String(req.body.label || '').slice(0, 128);
  const key = 'pdftk_' + crypto.randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO api_keys (key, user_id, label, created_at) VALUES (?, ?, ?, ?)')
    .run(key, req.user.id, label, Date.now());
  res.json({ key, label });
});

router.delete('/keys/:key', requireAuth, (req, res) => {
  db.prepare('DELETE FROM api_keys WHERE key = ? AND user_id = ?').run(req.params.key, req.user.id);
  res.json({ ok: true });
});

export default router;
