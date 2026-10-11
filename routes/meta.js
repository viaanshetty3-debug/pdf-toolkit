import { Router } from 'express';
import { upload, loadPdf, httpError } from '../lib/pdf-utils.js';

const router = Router();

/**
 * POST /api/inspect — returns metadata + page count for an uploaded PDF.
 * Used by UIs that need to render thumbnails or validate page ranges.
 */
router.post('/inspect', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    const doc = await loadPdf(req.file.buffer);
    const pages = doc.getPages().map((p, i) => {
      const { width, height } = p.getSize();
      return { index: i, width, height, rotation: p.getRotation().angle };
    });
    res.json({
      filename: req.file.originalname,
      size: req.file.size,
      pageCount: doc.getPageCount(),
      title: doc.getTitle() || null,
      author: doc.getAuthor() || null,
      pages,
    });
  } catch (e) { next(e); }
});

export default router;
