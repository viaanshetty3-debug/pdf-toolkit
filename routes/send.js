import { Router } from 'express';
import multer from 'multer';
import { createTransport } from 'nodemailer';
import { httpError } from '../lib/pdf-utils.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } });

/**
 * POST /api/send — email a file as attachment. Requires SMTP env vars:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *   (SMTP_SECURE optional — "1" to use TLS)
 *
 * The point is to let the user send a processed PDF without downloading-then-
 * reattaching in their mail client.
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
    if (!SMTP_HOST || !SMTP_FROM) {
      throw httpError(503, 'SMTP is not configured on this server. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM env vars.');
    }
    if (!req.file) throw httpError(400, 'file attachment required');
    const to = String(req.body.to || '').trim();
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(to)) throw httpError(400, 'Valid "to" email required');
    const subject = String(req.body.subject || `A file from PDF Toolkit`).slice(0, 256);
    const text = String(req.body.message || '').slice(0, 10000);

    const transport = createTransport({
      host: SMTP_HOST,
      port: parseInt(SMTP_PORT || '587', 10),
      secure: SMTP_SECURE === '1' || parseInt(SMTP_PORT || '587', 10) === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });

    await transport.sendMail({
      from: SMTP_FROM,
      to, subject, text,
      attachments: [{ filename: req.file.originalname, content: req.file.buffer, contentType: req.file.mimetype }],
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** GET /api/send/status — report whether SMTP is configured. */
router.get('/status', (req, res) => {
  res.json({ configured: !!(process.env.SMTP_HOST && process.env.SMTP_FROM) });
});

export default router;
