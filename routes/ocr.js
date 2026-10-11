import { Router } from 'express';
import multer from 'multer';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { loadPdf, sendPdf, httpError } from '../lib/pdf-utils.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024, files: 1 },
});

/**
 * POST /api/ocr — embed an OCR text layer into a PDF.
 *
 * The browser runs tesseract.js and sends the recognised words + bounding
 * boxes per page. We overlay the words as invisible (0 opacity) text so
 * the resulting PDF becomes searchable without altering the visible page.
 *
 * Form:
 *   file         the source PDF
 *   layer        JSON: [{ page, pageWidth, pageHeight, words: [{text,x,y,w,h}] }]
 *                Coordinates are in the browser canvas space; we scale them
 *                to the PDF page's media box.
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    let layer;
    try { layer = JSON.parse(req.body.layer || '[]'); } catch { throw httpError(400, 'layer must be JSON'); }
    if (!Array.isArray(layer)) throw httpError(400, 'layer must be an array');

    const doc = await loadPdf(req.file.buffer);
    const font = await doc.embedFont(StandardFonts.Helvetica);

    for (const p of layer) {
      const page = doc.getPage(p.page);
      if (!page) continue;
      const { width: pw, height: ph } = page.getSize();
      const sx = pw / p.pageWidth;
      const sy = ph / p.pageHeight;
      for (const w of (p.words || [])) {
        if (!w.text || !w.text.trim()) continue;
        const text = String(w.text);
        const size = Math.max(4, w.h * sy * 0.9);
        // Position: convert top-left origin → bottom-left.
        const x = w.x * sx;
        const y = ph - (w.y + w.h) * sy;
        // Invisible text (opacity 0) with 0-width stroke; still searchable.
        page.drawText(text, { x, y, size, font, color: rgb(1, 1, 1), opacity: 0 });
      }
    }
    const bytes = await doc.save();
    sendPdf(res, bytes, 'ocr.pdf');
  } catch (e) { next(e); }
});

export default router;
