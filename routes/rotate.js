import { Router } from 'express';
import { degrees } from 'pdf-lib';
import { upload, loadPdf, parseRangeSpec, sendPdf, httpError } from '../lib/pdf-utils.js';

const router = Router();

/**
 * POST /api/rotate
 *   file     the PDF
 *   angle    90 | 180 | 270 (relative — added to current rotation)
 *   pages    "all" | "1-3,5"  default "all"
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    const angle = parseInt(req.body.angle, 10);
    if (![90, 180, 270].includes(angle)) throw httpError(400, 'angle must be 90, 180, or 270');
    const doc = await loadPdf(req.file.buffer);
    const pageCount = doc.getPageCount();
    const which = (req.body.pages || 'all').trim();
    const indices = which === 'all'
      ? doc.getPageIndices()
      : parseRangeSpec(which, pageCount);
    for (const i of indices) {
      const p = doc.getPage(i);
      p.setRotation(degrees((p.getRotation().angle + angle) % 360));
    }
    const bytes = await doc.save();
    sendPdf(res, bytes, 'rotated.pdf');
  } catch (e) { next(e); }
});

export default router;
