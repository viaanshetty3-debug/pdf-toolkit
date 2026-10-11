import { Router } from 'express';
import multer from 'multer';
import { PDFDocument } from 'pdf-lib';
import { sendPdf, httpError } from '../lib/pdf-utils.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024, files: 100 },
});

/**
 * POST /api/scan — assemble webcam-captured frames into a PDF.
 * One page per frame; page size matches the image.
 */
router.post('/', upload.array('frames', 100), async (req, res, next) => {
  try {
    if (!req.files?.length) throw httpError(400, 'No frames uploaded');
    const doc = await PDFDocument.create();
    for (const f of req.files) {
      const bytes = new Uint8Array(f.buffer);
      const img = f.mimetype === 'image/png'
        ? await doc.embedPng(bytes)
        : await doc.embedJpg(bytes);
      const page = doc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
    const bytes = await doc.save();
    sendPdf(res, bytes, 'scanned.pdf');
  } catch (e) { next(e); }
});

export default router;
