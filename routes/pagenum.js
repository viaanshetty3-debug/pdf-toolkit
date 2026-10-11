import { Router } from 'express';
import { StandardFonts, rgb } from 'pdf-lib';
import { upload, loadPdf, parseRangeSpec, sendPdf, httpError } from '../lib/pdf-utils.js';

const router = Router();

const MARGIN = 24;

/**
 * POST /api/pagenum
 *   file
 *   position   bottom-center (default) | bottom-left | bottom-right
 *              | top-center | top-left | top-right
 *   startFrom  integer (default 1)
 *   fontSize   default 11
 *   format     e.g. "Page {n} of {total}" (default "{n}")
 *   pages      "all" | range spec (default "all")
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    const position = req.body.position || 'bottom-center';
    const startFrom = parseInt(req.body.startFrom || '1', 10);
    const fontSize = parseFloat(req.body.fontSize || '11');
    const format = req.body.format || '{n}';
    if (!Number.isFinite(startFrom) || !Number.isFinite(fontSize) || fontSize <= 0) {
      throw httpError(400, 'Invalid numeric parameter');
    }
    const doc = await loadPdf(req.file.buffer);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pageCount = doc.getPageCount();
    const which = (req.body.pages || 'all').trim();
    const indices = which === 'all'
      ? doc.getPageIndices()
      : parseRangeSpec(which, pageCount);

    const total = indices.length;
    for (let k = 0; k < indices.length; k++) {
      const page = doc.getPage(indices[k]);
      const { width, height } = page.getSize();
      const text = format.replace(/\{n\}/g, String(startFrom + k)).replace(/\{total\}/g, String(total));
      const textWidth = font.widthOfTextAtSize(text, fontSize);
      let x, y;
      if (position.endsWith('left')) x = MARGIN;
      else if (position.endsWith('right')) x = width - textWidth - MARGIN;
      else x = (width - textWidth) / 2;
      y = position.startsWith('top') ? height - MARGIN : MARGIN - fontSize / 2;
      page.drawText(text, { x, y, size: fontSize, font, color: rgb(0.2, 0.2, 0.2) });
    }
    const bytes = await doc.save();
    sendPdf(res, bytes, 'numbered.pdf');
  } catch (e) { next(e); }
});

export default router;
