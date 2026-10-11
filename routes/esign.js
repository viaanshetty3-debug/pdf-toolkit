import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { db } from '../lib/db.js';
import { httpError, sendPdf } from '../lib/pdf-utils.js';
import { PDFDocument } from 'pdf-lib';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } });

const MAX_TTL_DAYS = 90;
const DEFAULT_TTL_DAYS = 30;

/**
 * POST /api/esign/request — ask someone to sign a PDF.
 *   file         the PDF
 *   email        signer email
 *   name         (optional) signer name
 *   message      (optional) note to show the signer
 *   expires_days 1..90 (default 30)
 *
 * Returns { token, signing_url }. The signing URL goes to the signer; we don't
 * send email unless SMTP is configured (see /api/send/configure). If SMTP
 * isn't set up, the caller copies the signing URL and sends it themselves.
 */
router.post('/request', upload.single('file'), (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'file required');
    const email = String(req.body.email || '').trim();
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) throw httpError(400, 'Valid signer email required');
    const name = String(req.body.name || '').slice(0, 128);
    const message = String(req.body.message || '').slice(0, 2000);
    const days = Math.max(1, Math.min(MAX_TTL_DAYS, parseInt(req.body.expires_days || DEFAULT_TTL_DAYS, 10)));
    const token = crypto.randomBytes(16).toString('base64url');
    const now = Date.now();
    db.prepare(`INSERT INTO esign_requests (token, user_id, filename, pdf_blob, signer_email,
                signer_name, message, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(token, req.user?.id ?? null,
           req.file.originalname.slice(0, 256),
           req.file.buffer, email, name, message,
           now, now + days * 86400 * 1000);
    const base = `${req.protocol}://${req.get('host')}`;
    res.json({ token, signing_url: `${base}/sign/${token}`, signer_email: email });
  } catch (e) { next(e); }
});

/** GET /api/esign/:token — fetch request details (used by signing page). */
router.get('/:token', (req, res, next) => {
  try {
    const row = db.prepare(`SELECT token, filename, signer_email, signer_name, message,
                            created_at, expires_at, status FROM esign_requests WHERE token = ?`).get(req.params.token);
    if (!row) throw httpError(404, 'Not found');
    if (row.expires_at < Date.now() && row.status === 'pending') {
      db.prepare('UPDATE esign_requests SET status = ? WHERE token = ?').run('expired', req.params.token);
      row.status = 'expired';
    }
    res.json(row);
  } catch (e) { next(e); }
});

/** GET /api/esign/:token/pdf — fetch the PDF (original if pending, signed if complete). */
router.get('/:token/pdf', (req, res, next) => {
  try {
    const row = db.prepare('SELECT filename, pdf_blob, signed_blob, status FROM esign_requests WHERE token = ?')
      .get(req.params.token);
    if (!row) throw httpError(404, 'Not found');
    const bytes = row.status === 'signed' && row.signed_blob ? row.signed_blob : row.pdf_blob;
    sendPdf(res, Buffer.from(bytes), row.filename);
  } catch (e) { next(e); }
});

/**
 * POST /api/esign/:token/sign — the signer submits an image stamp (and
 * placement). We draw it onto page 1 and store the result.
 *   signature  PNG/JPEG image
 *   x, y, w, h placement in points, top-left origin on page 1
 *   page       0-indexed page to stamp (default 0)
 */
router.post('/:token/sign', upload.single('signature'), async (req, res, next) => {
  try {
    const row = db.prepare('SELECT * FROM esign_requests WHERE token = ?').get(req.params.token);
    if (!row) throw httpError(404, 'Not found');
    if (row.status !== 'pending') throw httpError(400, `Request already ${row.status}`);
    if (row.expires_at < Date.now()) throw httpError(410, 'Request expired');
    if (!req.file) throw httpError(400, 'signature image required');
    const page = parseInt(req.body.page || '0', 10);
    const x = parseFloat(req.body.x);
    const y = parseFloat(req.body.y);
    const w = parseFloat(req.body.w);
    const h = parseFloat(req.body.h);
    if ([x, y, w, h].some(v => !Number.isFinite(v))) throw httpError(400, 'Invalid placement');

    const doc = await PDFDocument.load(Buffer.from(row.pdf_blob), { ignoreEncryption: true });
    const bytes = new Uint8Array(req.file.buffer);
    const img = req.file.mimetype === 'image/png'
      ? await doc.embedPng(bytes)
      : await doc.embedJpg(bytes);
    const target = doc.getPage(page);
    if (!target) throw httpError(400, `Invalid page: ${page}`);
    const { height } = target.getSize();
    target.drawImage(img, { x, y: height - y - h, width: w, height: h });
    const signed = Buffer.from(await doc.save());

    db.prepare(`UPDATE esign_requests SET status = 'signed', signed_at = ?, signed_blob = ? WHERE token = ?`)
      .run(Date.now(), signed, req.params.token);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** GET /api/esign — list requests owned by the user. */
router.get('/', (req, res) => {
  const userId = req.user?.id ?? null;
  const rows = db.prepare(`SELECT token, filename, signer_email, signer_name, created_at,
                           expires_at, status, signed_at FROM esign_requests
                           WHERE user_id IS ? OR user_id = ?
                           ORDER BY created_at DESC`).all(userId, userId);
  res.json({ requests: rows });
});

router.delete('/:token', (req, res) => {
  const userId = req.user?.id ?? null;
  db.prepare('DELETE FROM esign_requests WHERE token = ? AND (user_id IS ? OR user_id = ?)')
    .run(req.params.token, userId, userId);
  res.json({ ok: true });
});

export default router;
