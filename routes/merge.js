import { Router } from 'express';
import { PDFDocument } from 'pdf-lib';
import { upload, loadPdf, sendPdf, copyPages, httpError } from '../lib/pdf-utils.js';

const router = Router();

/**
 * POST /api/merge — merges files in the order they are received.
 * Form field: files[] (multiple). Optional: order (JSON array of indices)
 * to override upload order.
 */
router.post('/', upload.array('files', 50), async (req, res, next) => {
  try {
    if (!req.files || req.files.length < 2) {
      throw httpError(400, 'At least two PDFs are required');
    }
    let order;
    try {
      order = req.body.order ? JSON.parse(req.body.order) : req.files.map((_, i) => i);
    } catch {
      throw httpError(400, 'order must be a JSON array of indices');
    }
    if (!Array.isArray(order) || order.length !== req.files.length) {
      throw httpError(400, 'order length must match number of files');
    }
    const out = await PDFDocument.create();
    for (const idx of order) {
      const f = req.files[idx];
      if (!f) throw httpError(400, `Invalid file index: ${idx}`);
      const src = await loadPdf(f.buffer);
      await copyPages(src, out, src.getPageIndices());
    }
    const bytes = await out.save();
    sendPdf(res, bytes, 'merged.pdf');
  } catch (e) { next(e); }
});

export default router;
