import { Router } from 'express';
import { upload, loadPdf, sendPdf, httpError } from '../lib/pdf-utils.js';

const router = Router();

/**
 * POST /api/crop — apply a uniform margin crop to every page.
 *   file
 *   top, right, bottom, left   margins in points (1pt = 1/72 inch)
 * Sets CropBox so viewers show the cropped area without altering media size.
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    const top = parseFloat(req.body.top || '0');
    const right = parseFloat(req.body.right || '0');
    const bottom = parseFloat(req.body.bottom || '0');
    const left = parseFloat(req.body.left || '0');
    if ([top, right, bottom, left].some(v => !Number.isFinite(v) || v < 0)) {
      throw httpError(400, 'Margins must be non-negative numbers');
    }
    const doc = await loadPdf(req.file.buffer);
    for (const page of doc.getPages()) {
      const { width, height } = page.getSize();
      const x = left, y = bottom;
      const w = width - left - right;
      const h = height - top - bottom;
      if (w <= 0 || h <= 0) throw httpError(400, 'Crop margins exceed page size');
      page.setCropBox(x, y, w, h);
    }
    const bytes = await doc.save();
    sendPdf(res, bytes, 'cropped.pdf');
  } catch (e) { next(e); }
});

export default router;
