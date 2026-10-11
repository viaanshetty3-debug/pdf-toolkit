import { Router } from 'express';
import multer from 'multer';
import { db } from '../lib/db.js';
import { httpError } from '../lib/pdf-utils.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } });

const MAX_PER_USER = 50;  // most recent entries kept

/**
 * POST /api/history — record a file (multipart `blob` + `tool` + `filename` fields).
 * Associates with req.user if logged in; otherwise stored anonymously (NULL
 * user_id) so a shared-server/local-browser flow still works.
 */
router.post('/', upload.single('blob'), (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'blob required');
    const tool = String(req.body.tool || 'unknown').slice(0, 64);
    const filename = String(req.body.filename || req.file.originalname || 'file').slice(0, 256);
    const mime = req.file.mimetype || 'application/octet-stream';
    const userId = req.user?.id ?? null;
    db.prepare(`INSERT INTO history (user_id, tool, filename, mime, size, blob, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(userId, tool, filename, mime, req.file.size, req.file.buffer, Date.now());
    // Trim per-user to MAX_PER_USER most recent.
    db.prepare(`DELETE FROM history WHERE id IN (
      SELECT id FROM history WHERE (user_id IS ? OR user_id = ?)
      ORDER BY created_at DESC LIMIT -1 OFFSET ?
    )`).run(userId, userId, MAX_PER_USER);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/', (req, res) => {
  const userId = req.user?.id ?? null;
  const rows = db.prepare(`SELECT id, tool, filename, mime, size, created_at
                           FROM history WHERE user_id IS ? OR user_id = ?
                           ORDER BY created_at DESC LIMIT 50`).all(userId, userId);
  res.json({ entries: rows });
});

router.get('/:id/download', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = req.user?.id ?? null;
    const row = db.prepare(`SELECT filename, mime, blob FROM history
                            WHERE id = ? AND (user_id IS ? OR user_id = ?)`)
      .get(id, userId, userId);
    if (!row) throw httpError(404, 'Not found');
    res.setHeader('Content-Type', row.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${row.filename.replace(/"/g, '')}"`);
    res.end(Buffer.from(row.blob));
  } catch (e) { next(e); }
});

router.delete('/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = req.user?.id ?? null;
    db.prepare('DELETE FROM history WHERE id = ? AND (user_id IS ? OR user_id = ?)')
      .run(id, userId, userId);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/', (req, res) => {
  const userId = req.user?.id ?? null;
  db.prepare('DELETE FROM history WHERE user_id IS ? OR user_id = ?').run(userId, userId);
  res.json({ ok: true });
});

export default router;
