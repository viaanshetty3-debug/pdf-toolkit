import { Router } from 'express';
import { PDFDocument } from 'pdf-lib';
import { upload, loadPdf, parseRangeSpec, copyPages, sendPdf, httpError } from '../lib/pdf-utils.js';

const router = Router();

/**
 * POST /api/remove — removes the specified pages, keeps the rest.
 * Form fields: file, ranges="1-2,5".
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    const src = await loadPdf(req.file.buffer);
    const pageCount = src.getPageCount();
    const toRemove = new Set(parseRangeSpec(req.body.ranges, pageCount));
    const keep = src.getPageIndices().filter(i => !toRemove.has(i));
    if (keep.length === 0) throw httpError(400, 'Cannot remove every page');
    const out = await PDFDocument.create();
    await copyPages(src, out, keep);
    const bytes = await out.save();
    sendPdf(res, bytes, 'cleaned.pdf');
  } catch (e) { next(e); }
});

export default router;
