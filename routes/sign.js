import { Router } from 'express';
import multer from 'multer';
import { loadPdf, sendPdf, httpError } from '../lib/pdf-utils.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024, files: 2 },
});

/**
 * POST /api/sign — stamp a signature image on specified pages.
 *   file         the PDF
 *   signature    image file (PNG preferred for transparency)
 *   page         0-based page index
 *   x, y, w, h   placement in PDF points, top-left origin
 *
 * This is a VISUAL stamp. Not a cryptographic signature.
 */
router.post('/', upload.fields([{ name: 'file', maxCount: 1 }, { name: 'signature', maxCount: 1 }]),
  async (req, res, next) => {
  try {
    const pdfFile = req.files?.file?.[0];
    const sig = req.files?.signature?.[0];
    if (!pdfFile) throw httpError(400, 'No PDF file uploaded');
    if (!sig) throw httpError(400, 'No signature image uploaded');
    const page = parseInt(req.body.page, 10);
    const x = parseFloat(req.body.x);
    const y = parseFloat(req.body.y);
    const w = parseFloat(req.body.w);
    const h = parseFloat(req.body.h);
    if ([page, x, y, w, h].some(v => !Number.isFinite(v))) throw httpError(400, 'Invalid placement');

    const doc = await loadPdf(pdfFile.buffer);
    const sigBytes = new Uint8Array(sig.buffer);
    const img = sig.mimetype === 'image/png'
      ? await doc.embedPng(sigBytes)
      : await doc.embedJpg(sigBytes);
    const target = doc.getPage(page);
    if (!target) throw httpError(400, `Invalid page: ${page}`);
    const { height } = target.getSize();
    target.drawImage(img, { x, y: height - y - h, width: w, height: h });
    const bytes = await doc.save();
    sendPdf(res, bytes, 'signed.pdf');
  } catch (e) { next(e); }
});

export default router;
