import { Router } from 'express';
import { PDFDocument, degrees } from 'pdf-lib';
import { upload, loadPdf, sendPdf, httpError } from '../lib/pdf-utils.js';

const router = Router();

/**
 * POST /api/organize — reorder, rotate, and delete pages in one pass.
 * Form fields:
 *   file     the source PDF
 *   ops      JSON array of { from: <0-based source index>, rotate?: 0|90|180|270 }
 *            Order of the array is the output order. Omit a page to delete it.
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    let ops;
    try { ops = JSON.parse(req.body.ops || '[]'); } catch {
      throw httpError(400, 'ops must be a JSON array');
    }
    if (!Array.isArray(ops) || ops.length === 0) {
      throw httpError(400, 'ops must be a non-empty array');
    }
    const src = await loadPdf(req.file.buffer);
    const pageCount = src.getPageCount();
    for (const op of ops) {
      if (typeof op.from !== 'number' || op.from < 0 || op.from >= pageCount) {
        throw httpError(400, `Invalid op.from: ${op.from}`);
      }
      if (op.rotate != null && ![0, 90, 180, 270].includes(op.rotate)) {
        throw httpError(400, `Invalid op.rotate: ${op.rotate}`);
      }
    }
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, ops.map(op => op.from));
    copied.forEach((page, i) => {
      const op = ops[i];
      if (op.rotate) {
        const current = page.getRotation().angle;
        page.setRotation(degrees((current + op.rotate) % 360));
      }
      out.addPage(page);
    });
    const bytes = await out.save();
    sendPdf(res, bytes, 'organized.pdf');
  } catch (e) { next(e); }
});

export default router;
