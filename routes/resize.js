import { Router } from 'express';
import { PDFDocument } from 'pdf-lib';
import { upload, loadPdf, sendPdf, httpError } from '../lib/pdf-utils.js';

const router = Router();

const PRESETS = {
  letter: [612, 792],
  legal: [612, 1008],
  tabloid: [792, 1224],
  a3: [842, 1191],
  a4: [595, 842],
  a5: [420, 595],
  a6: [298, 420],
};

/**
 * POST /api/resize — scale every page to the target dimensions.
 *   file
 *   preset         letter | legal | tabloid | a3 | a4 | a5 | a6 | custom (default: a4)
 *   width, height  points, required when preset === custom
 *   fit            fit (preserve aspect, letterbox) | fill (stretch)  default: fit
 *   orientation    auto (default) | portrait | landscape
 *
 * Implementation: copy each page as a Form XObject into a fresh page of the
 * target size. This preserves vector content exactly; raster content is
 * scaled by the viewer at render time.
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    const preset = String(req.body.preset || 'a4').toLowerCase();
    const fit = req.body.fit === 'fill' ? 'fill' : 'fit';
    const orientation = ['portrait', 'landscape'].includes(req.body.orientation) ? req.body.orientation : 'auto';

    let targetW, targetH;
    if (preset === 'custom') {
      targetW = parseFloat(req.body.width);
      targetH = parseFloat(req.body.height);
      if (!Number.isFinite(targetW) || !Number.isFinite(targetH) || targetW <= 0 || targetH <= 0) {
        throw httpError(400, 'Custom preset requires valid width and height in points');
      }
    } else {
      const dims = PRESETS[preset];
      if (!dims) throw httpError(400, `Unknown preset: ${preset}`);
      [targetW, targetH] = dims;
    }

    const src = await loadPdf(req.file.buffer);
    const dst = await PDFDocument.create();
    const pageCount = src.getPageCount();
    const embedded = await dst.embedPdf(src, src.getPageIndices());

    for (let i = 0; i < pageCount; i++) {
      const srcPage = src.getPage(i);
      const srcSize = srcPage.getSize();
      // Decide orientation for this page.
      let w = targetW, h = targetH;
      if (orientation === 'auto') {
        const srcLandscape = srcSize.width > srcSize.height;
        const targetLandscape = w > h;
        if (srcLandscape !== targetLandscape) [w, h] = [h, w];
      } else if (orientation === 'landscape' && w < h) {
        [w, h] = [h, w];
      } else if (orientation === 'portrait' && w > h) {
        [w, h] = [h, w];
      }
      const page = dst.addPage([w, h]);
      const emb = embedded[i];
      const sx = w / srcSize.width;
      const sy = h / srcSize.height;
      let scaleX, scaleY, offsetX, offsetY;
      if (fit === 'fill') {
        scaleX = sx; scaleY = sy; offsetX = 0; offsetY = 0;
      } else {
        const s = Math.min(sx, sy);
        scaleX = s; scaleY = s;
        offsetX = (w - srcSize.width * s) / 2;
        offsetY = (h - srcSize.height * s) / 2;
      }
      page.drawPage(emb, {
        x: offsetX,
        y: offsetY,
        xScale: scaleX,
        yScale: scaleY,
      });
    }

    const bytes = await dst.save();
    sendPdf(res, bytes, 'resized.pdf');
  } catch (e) { next(e); }
});

export default router;
