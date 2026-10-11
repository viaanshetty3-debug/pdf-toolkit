import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { db } from '../lib/db.js';
import { httpError } from '../lib/pdf-utils.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } });

const MAX_TTL_DAYS = 30;
const DEFAULT_TTL_DAYS = 7;

/**
 * POST /api/share/create — upload a file + create an expiring share link.
 *   file          multipart file
 *   expires_days  1..30 (default 7)
 * Returns { token, url, expires_at }.
 */
router.post('/create', upload.single('file'), (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'file required');
    const days = Math.max(1, Math.min(MAX_TTL_DAYS, parseInt(req.body.expires_days || DEFAULT_TTL_DAYS, 10)));
    const token = crypto.randomBytes(16).toString('base64url');
    const now = Date.now();
    const expiresAt = now + days * 86400 * 1000;
    db.prepare(`INSERT INTO share_links (token, user_id, filename, mime, size, blob, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(token, req.user?.id ?? null,
           req.file.originalname.slice(0, 256),
           req.file.mimetype || 'application/octet-stream',
           req.file.size, req.file.buffer, now, expiresAt);
    const base = `${req.protocol}://${req.get('host')}`;
    res.json({ token, url: `${base}/share/${token}`, expires_at: expiresAt });
  } catch (e) { next(e); }
});

/**
 * GET /api/share/:token — download the shared file. No auth; the token IS the
 * auth. Expired links return 410 Gone.
 */
router.get('/:token', (req, res, next) => {
  try {
    const token = req.params.token;
    const row = db.prepare('SELECT * FROM share_links WHERE token = ?').get(token);
    if (!row) throw httpError(404, 'Not found');
    if (row.expires_at < Date.now()) {
      res.status(410).json({ error: 'This link has expired' });
      return;
    }
    db.prepare('UPDATE share_links SET downloads = downloads + 1 WHERE token = ?').run(token);
    res.setHeader('Content-Type', row.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${row.filename.replace(/"/g, '')}"`);
    res.end(Buffer.from(row.blob));
  } catch (e) { next(e); }
});

/** GET /api/share — list the current user's share links. */
router.get('/', (req, res) => {
  const userId = req.user?.id ?? null;
  const rows = db.prepare(`SELECT token, filename, mime, size, created_at, expires_at, downloads
                           FROM share_links WHERE user_id IS ? OR user_id = ?
                           ORDER BY created_at DESC`).all(userId, userId);
  res.json({ links: rows });
});

router.delete('/:token', (req, res, next) => {
  try {
    const userId = req.user?.id ?? null;
    db.prepare('DELETE FROM share_links WHERE token = ? AND (user_id IS ? OR user_id = ?)')
      .run(req.params.token, userId, userId);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
