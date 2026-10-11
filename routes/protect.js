import { Router } from 'express';
import { upload, sendPdf, httpError } from '../lib/pdf-utils.js';
import { runQpdf } from './unlock.js';

const router = Router();

/**
 * POST /api/protect — add a password to a PDF.
 *   file
 *   userPassword    required: open password
 *   ownerPassword   optional: owner (permissions) password; defaults to userPassword
 *   printing        allow/none  default allow
 *   modify          allow/none  default none
 *   extract         allow/none  default none
 *   keyLength       256 (default) | 128 | 40
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    const userPassword = String(req.body.userPassword ?? '');
    if (!userPassword) throw httpError(400, 'userPassword required');
    const ownerPassword = String(req.body.ownerPassword || userPassword);
    const keyLength = ['40', '128', '256'].includes(String(req.body.keyLength)) ? String(req.body.keyLength) : '256';

    const args = [
      '--encrypt',
      userPassword,
      ownerPassword,
      keyLength,
    ];
    // qpdf permission flags come after the key length.
    if (req.body.printing === 'none') args.push('--print=none');
    if (req.body.modify !== 'allow') args.push('--modify=none');
    if (req.body.extract !== 'allow') args.push('--extract=n');
    args.push('--');

    const bytes = await runQpdf(args, req.file.buffer);
    sendPdf(res, bytes, 'protected.pdf');
  } catch (e) { next(e); }
});

export default router;
