import { Router } from 'express';
import { PDFDocument } from 'pdf-lib';
import { upload, loadPdf, parseRangeSpec, copyPages, sendPdf, httpError } from '../lib/pdf-utils.js';

const router = Router();

/**
 * POST /api/extract — produces a new PDF containing only the specified pages.
 * Ranges can be repeated (e.g. "1,1,2") to duplicate pages.
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    const src = await loadPdf(req.file.buffer);
    const pageCount = src.getPageCount();
    // Preserve order and duplicates — bypass the dedup in parseRangeSpec.
    const indices = [];
    for (const token of (req.body.ranges || '').split(',').map(t => t.trim()).filter(Boolean)) {
      const resolved = parseRangeSpec(token, pageCount);
      indices.push(...resolved);
    }
    if (indices.length === 0) throw httpError(400, 'No pages selected');
    const out = await PDFDocument.create();
    await copyPages(src, out, indices);
    const bytes = await out.save();
    sendPdf(res, bytes, 'extracted.pdf');
  } catch (e) { next(e); }
});

export default router;
