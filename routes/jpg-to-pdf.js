import { Router } from 'express';
import multer from 'multer';
import { PDFDocument } from 'pdf-lib';
import { sendPdf, httpError } from '../lib/pdf-utils.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024, files: 200 },
});

/**
 * POST /api/jpg-to-pdf — build a PDF from image files.
 * Form:
 *   files[]       PNG and/or JPEG files
 *   pageSize      "image" (default) — one page per image, sized to the image
 *                 "letter"           — US Letter, image centered + fitted
 *                 "a4"               — A4, image centered + fitted
 *   margin        pt (default 0 for "image", 36 for Letter/A4)
 */
router.post('/', upload.array('files', 200), async (req, res, next) => {
  try {
    if (!req.files?.length) throw httpError(400, 'No files uploaded');
    const pageSize = (req.body.pageSize || 'image').toLowerCase();
    const sizes = { letter: [612, 792], a4: [595, 842] };
    const margin = parseFloat(req.body.margin ?? (pageSize === 'image' ? '0' : '36'));
    const doc = await PDFDocument.create();
    for (const f of req.files) {
      const bytes = new Uint8Array(f.buffer);
      const img = f.mimetype === 'image/png'
        ? await doc.embedPng(bytes)
        : await doc.embedJpg(bytes);
      let pageW, pageH;
      if (pageSize === 'image') { pageW = img.width; pageH = img.height; }
      else { [pageW, pageH] = sizes[pageSize] || sizes.letter; }
      const page = doc.addPage([pageW, pageH]);
      if (pageSize === 'image') {
        page.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });
      } else {
        const maxW = pageW - margin * 2;
        const maxH = pageH - margin * 2;
        const r = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * r, h = img.height * r;
        page.drawImage(img, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h });
      }
    }
    const bytes = await doc.save();
    sendPdf(res, bytes, 'images.pdf');
  } catch (e) { next(e); }
});

export default router;
